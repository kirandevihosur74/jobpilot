import asyncio
import base64
import json
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from playwright.async_api import async_playwright, Page
import openai

logger = logging.getLogger("jobpilot.apply")
router = APIRouter(prefix="/api/apply", tags=["apply"])

# ── session store ────────────────────────────────────────────────────────────
# session_id -> {status, screenshot, message, error, _confirm_event, _abort_event}
_sessions: dict[str, dict] = {}

STATUS = {
    "STARTING":         "starting",
    "NAVIGATING":       "navigating",
    "FILLING":          "filling",
    "AWAIT_CONFIRM":    "awaiting_confirm",
    "SUBMITTING":       "submitting",
    "SUBMITTED":        "submitted",
    "FAILED":           "failed",
    "ABORTED":          "aborted",
}

_llm_client = None

def get_llm():
    global _llm_client
    if _llm_client is None:
        key = os.getenv("TOKENROUTER_API_KEY")
        base_url = os.getenv("TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1")
        if not key:
            raise RuntimeError("TOKENROUTER_API_KEY not set")
        _llm_client = openai.OpenAI(api_key=key, base_url=base_url)
    return _llm_client


# ── models ───────────────────────────────────────────────────────────────────
class ApplyRequest(BaseModel):
    job_url: str
    job: dict
    prefs: dict


class ConfirmRequest(BaseModel):
    session_id: str


# ── helpers ──────────────────────────────────────────────────────────────────
async def screenshot_b64(page: Page) -> str:
    png = await page.screenshot(full_page=False)
    return base64.b64encode(png).decode()


async def extract_fields(page) -> list[dict]:  # page or frame
    """Extract fillable fields using accessibility tree (robust across all ATS)."""
    # Accessibility tree sees all interactive elements regardless of CSS tricks
    try:
        snapshot = await page.accessibility.snapshot(interesting_only=True)
    except Exception as e:
        logger.warning("Accessibility snapshot failed: %s", e)
        snapshot = None

    acc_fields = []
    if snapshot:
        def walk(node, depth=0):
            if not node or depth > 15:
                return
            role = (node.get("role") or "").lower()
            name = node.get("name") or ""
            # Collect interactive input-like nodes
            if role in ("textbox", "combobox", "listbox", "checkbox", "radio",
                        "spinbutton", "searchbox", "switch"):
                acc_fields.append({
                    "role": role,
                    "label": name,
                    "value": node.get("value") or "",
                    "required": node.get("required", False),
                    "disabled": node.get("disabled", False),
                })
            for child in node.get("children") or []:
                walk(child, depth + 1)
        walk(snapshot)

    logger.info("Accessibility tree found %d interactive nodes", len(acc_fields))

    # Also run DOM query for id/name attributes needed for filling
    dom_fields = await page.evaluate("""
        () => {
            const SKIP = new Set(['hidden','submit','button','reset','image']);
            const els = Array.from(document.querySelectorAll('input, select, textarea'));
            return els
                .filter(el => !SKIP.has((el.type||'').toLowerCase()))
                .map(el => ({
                    id: el.id || '',
                    name: el.name || '',
                    tag: el.tagName.toLowerCase(),
                    type: el.type || 'text',
                    placeholder: el.placeholder || '',
                    ariaLabel: el.getAttribute('aria-label') || '',
                    required: el.required,
                    options: el.tagName === 'SELECT'
                        ? Array.from(el.options).map(o=>({val:o.value, text:o.text.trim()})).filter(o=>o.val)
                        : [],
                    checked: el.type === 'checkbox' ? el.checked : undefined,
                }));
        }
    """)

    logger.info("DOM query found %d raw fields", len(dom_fields))

    # Merge: match accessibility labels to DOM fields
    merged = []
    used_idx = set()

    for af in acc_fields:
        if af.get("disabled"):
            continue
        label = af["label"]
        # find matching DOM field by aria-label, placeholder, or id
        best = None
        for i, df in enumerate(dom_fields):
            if i in used_idx:
                continue
            if (label and (
                label.lower() in (df.get("ariaLabel") or "").lower() or
                label.lower() in (df.get("placeholder") or "").lower() or
                label.lower().replace(" ", "_") == (df.get("id") or "").lower() or
                label.lower().replace(" ", "_") == (df.get("name") or "").lower()
            )):
                best = (i, df)
                break
        if best:
            used_idx.add(best[0])
            df = best[1]
            merged.append({
                "uid": df["id"] or df["name"] or label,
                "tag": df["tag"],
                "type": df["type"],
                "name": df["name"],
                "id": df["id"],
                "placeholder": df["placeholder"],
                "label": label,
                "required": af["required"] or df["required"],
                "options": df["options"],
                "checked": df.get("checked"),
            })
        else:
            # No DOM match — use accessibility info only
            merged.append({
                "uid": label.replace(" ", "_").lower() or "field",
                "tag": "input",
                "type": "text" if af["role"] == "textbox" else af["role"],
                "name": "",
                "id": "",
                "placeholder": "",
                "label": label,
                "required": af["required"],
                "options": [],
                "checked": None,
            })

    # Fall back to raw DOM fields if accessibility found nothing
    if not merged and dom_fields:
        logger.info("Accessibility found nothing — falling back to raw DOM fields")
        for df in dom_fields:
            label = df.get("ariaLabel") or df.get("placeholder") or df.get("id") or df.get("name") or ""
            merged.append({
                "uid": df["id"] or df["name"] or label,
                "tag": df["tag"],
                "type": df["type"],
                "name": df["name"],
                "id": df["id"],
                "placeholder": df["placeholder"],
                "label": label,
                "required": df["required"],
                "options": df["options"],
                "checked": df.get("checked"),
            })

    logger.info("extract_fields final: %d fields: %s", len(merged),
                [(f.get("id") or f.get("name"), f.get("label")) for f in merged[:10]])
    return merged


def llm_fill_values(fields: list[dict], job: dict, prefs: dict) -> dict:
    field_summary = "\n".join(
        f"- id={f['id'] or f['name']} | label='{f['label']}' | type={f['type']}"
        + (f" | options: {[o['text'] for o in f['options'][:8]]}" if f["options"] else "")
        for f in fields if f["label"] or f["id"] or f["name"]
    )

    prompt = f"""You are filling a job application form on behalf of a candidate.

JOB:
Title: {job.get('title', '')}
Company: {job.get('company', '')}
Location: {job.get('location', '')}

CANDIDATE:
Role: {prefs.get('role', '')}
Skills: {', '.join(prefs.get('skills', []))}
Location preference: {prefs.get('location', '')}
Bio: {prefs.get('resumeContext', '')}

FORM FIELDS (id | label | type):
{field_summary}

Return ONLY a raw JSON object mapping each field's id (or name if no id) to the value to fill.
For select fields, return the exact option text. For checkboxes, return true/false.
For fields you cannot fill (file upload, captcha), return null.
Do not invent facts not in the candidate profile. Use empty string if unknown.

Example: {{"first_name": "Jane", "email": "jane@example.com", "years_exp": "5"}}"""

    resp = get_llm().chat.completions.create(
        model="anthropic/claude-sonnet-4.6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    import re
    text = resp.choices[0].message.content or "{}"
    text = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        logger.error("LLM fill values: no JSON found: %s", text[:200])
        return {}
    result = json.loads(m.group())
    logger.info("LLM fill values: %s", list(result.keys()))
    return result


async def _react_fill(page, selector: str, value: str):
    """Fill a text input and fire React's synthetic change event."""
    await page.evaluate("""
        ([sel, val]) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                             || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (nativeInput && nativeInput.set) {
                nativeInput.set.call(el, val);
            } else {
                el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    """, [selector, value])


async def fill_form(page, field_values: dict, fields: list[dict]):  # page or frame
    field_map = {f["id"]: f for f in fields if f["id"]}
    field_map.update({f["name"]: f for f in fields if f["name"] and f["name"] not in field_map})

    for key, value in field_values.items():
        if value is None:
            continue
        f = field_map.get(key)
        if not f:
            continue
        # Build selector: prefer id (Greenhouse has clean ids like "first_name")
        fid = f.get("id")
        fname = f.get("name", "")
        selector = f'#{fid}' if fid else f'[name="{fname}"]'
        try:
            el = page.locator(selector).first
            if not await el.count():
                logger.debug("Field not found: %s", selector)
                continue
            ftype = f.get("type", "text")
            tag = f.get("tag", "input")

            if ftype == "checkbox":
                is_checked = await el.is_checked()
                if bool(value) != is_checked:
                    await el.click()
            elif ftype == "radio":
                await el.check()
            elif tag == "select":
                try:
                    await el.select_option(label=str(value))
                except Exception:
                    try:
                        await el.select_option(value=str(value))
                    except Exception:
                        pass
            elif ftype in ("text", "email", "tel", "url", "number", "search", "password", ""):
                # Use React-aware fill so controlled inputs update
                await _react_fill(page, selector, str(value))
                # Also try native fill as fallback
                try:
                    await el.fill(str(value))
                except Exception:
                    pass
            elif tag == "textarea":
                await _react_fill(page, selector, str(value))
                try:
                    await el.fill(str(value))
                except Exception:
                    pass
            logger.debug("Filled %s = %s", key, str(value)[:30])
            await asyncio.sleep(0.08)
        except Exception as e:
            logger.debug("Field fill skip %s: %s", key, e)


# ATS platforms that embed their form in an IFRAME inside a company's own site
ATS_IFRAME_PATTERNS = [
    "greenhouse.io", "grnh.se",
    "lever.co", "jobs.lever.co",
    "workday.com", "myworkdayjobs.com",
]

# ATS platforms that ARE the job page themselves — no iframe, form is on main page
ATS_NATIVE_PATTERNS = [
    "ashbyhq.com",
    "jobs.lever.co",
    "boards.greenhouse.io",
]

async def get_active_frame(page: Page):
    """Return the best frame to interact with.

    If we're already on a native ATS URL (Ashby, Lever, Greenhouse boards),
    the form is on the main page — return immediately without hunting for iframes.
    """
    current_url = page.url or ""

    # Native ATS — form is on the main page, skip iframe search entirely
    if any(p in current_url for p in ATS_NATIVE_PATTERNS):
        logger.info("Native ATS detected (%s) — using main page directly", current_url[:60])
        # Give React/JS a moment to render the form
        try:
            await page.wait_for_selector(
                'input:not([type=hidden]), select, textarea',
                timeout=6000,
            )
        except Exception:
            pass
        return page

    # Otherwise hunt for an embedded ATS iframe (company sites embedding Greenhouse etc.)
    for attempt in range(6):
        await asyncio.sleep(1.0)
        for frame in page.frames:
            url = frame.url or ""
            if frame is page.main_frame:
                continue
            if any(p in url for p in ATS_IFRAME_PATTERNS):
                try:
                    await frame.wait_for_selector(
                        'input:not([type=hidden]), select, textarea',
                        timeout=3000,
                    )
                    logger.info("ATS iframe ready (attempt %d): %s", attempt, url[:80])
                    return frame
                except Exception:
                    logger.debug("ATS iframe found but no inputs yet (attempt %d): %s", attempt, url[:80])
                    continue
        iframes = await page.locator("iframe").all()
        for iframe_el in iframes:
            src = (await iframe_el.get_attribute("src") or "").lower()
            if any(p in src for p in ATS_IFRAME_PATTERNS):
                frame = await iframe_el.content_frame()
                if frame:
                    try:
                        await frame.wait_for_selector(
                            'input:not([type=hidden]), select, textarea',
                            timeout=3000,
                        )
                        logger.info("ATS iframe ready via src attr (attempt %d): %s", attempt, src[:80])
                        return frame
                    except Exception:
                        pass
    logger.info("No ATS iframe found — using main page")
    return page


LOGIN_SIGNALS = [
    "sign in", "log in", "login", "create account", "sign up",
    "join to apply", "please log in", "register to apply",
]

async def detect_login_wall(page: Page) -> bool:
    try:
        text = (await page.inner_text("body")).lower()
        return any(s in text for s in LOGIN_SIGNALS) and (
            await page.locator('input[type="password"]').count() > 0
            or await page.locator('input[name*="password" i]').count() > 0
        )
    except Exception:
        return False


async def find_and_click_apply(page: Page) -> bool:
    current_url = page.url or ""

    # Ashby: navigate directly to /application sub-page (most reliable)
    if "ashbyhq.com" in current_url and "/application" not in current_url:
        app_url = current_url.rstrip("/") + "/application"
        logger.info("Ashby: navigating directly to %s", app_url)
        try:
            await page.goto(app_url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(1.5)
            return True
        except Exception as e:
            logger.warning("Ashby direct /application nav failed: %s", e)

    selectors = [
        # Ashby-specific
        'button:text-matches("apply for this job", "i")',
        'a:text-matches("apply for this job", "i")',
        'a[href*="/application"]',
        # Lever-specific
        'a.template-btn-submit',
        'a[href*="apply/email"]',
        # Generic — most specific first
        'button:text-matches("^apply now$", "i")',
        'a:text-matches("^apply now$", "i")',
        'button:text-matches("^apply$", "i")',
        'a:text-matches("^apply$", "i")',
        'button:text-matches("apply", "i")',
        # attribute-based fallbacks
        '[class*="apply-btn" i]', '[class*="applyBtn" i]', '[id*="apply-btn" i]',
        'a[href*="apply" i]:not([href*="blog"]):not([href*="news"]):not([href*="employer"])',
    ]
    for sel in selectors:
        try:
            els = page.locator(sel)
            count = await els.count()
            for i in range(count):
                el = els.nth(i)
                if not await el.is_visible():
                    continue
                await el.click()
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                except Exception:
                    await asyncio.sleep(2)
                logger.info("Clicked apply button via: %s", sel)
                return True
        except Exception:
            pass
    return False


EXCLUDED_SUBMIT_VALUES = {"upload", "browse", "choose", "attach", "add file", "remove", "delete", "cancel"}

async def find_next_button(page: Page):
    # Ordered by specificity — most specific first
    selectors = [
        'button:text-matches("^(submit application|submit|apply now|apply)$", "i")',
        'button:text-matches("^(next|continue|next step|save and continue)$", "i")',
        'button[type="submit"]:not([style*="display:none"]):not([style*="display: none"])',
        'input[type="submit"]:not([style*="display:none"]):not([style*="display: none"])',
    ]
    for sel in selectors:
        try:
            els = page.locator(sel)
            count = await els.count()
            for i in range(count):
                el = els.nth(i)
                if not await el.is_visible():
                    continue
                # skip upload / file-related buttons
                val = (await el.get_attribute("value") or "").lower().strip()
                text = (await el.inner_text().catch(lambda _: "")) if hasattr(el, "inner_text") else ""
                try:
                    text = (await el.inner_text()).lower().strip()
                except Exception:
                    text = ""
                combined = val or text
                if any(ex in combined for ex in EXCLUDED_SUBMIT_VALUES):
                    continue
                return el
        except Exception:
            pass
    return None


# ── main apply agent ─────────────────────────────────────────────────────────
async def _run_apply(session_id: str, job_url: str, job: dict, prefs: dict):
    session = _sessions[session_id]
    confirm_event: asyncio.Event = session["_confirm_event"]
    abort_event: asyncio.Event = session["_abort_event"]

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        # Hide automation signals
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        """)
        page = await context.new_page()
        logger.info("Launched stealth Chromium")

        try:
            # 1. Navigate
            session["status"] = STATUS["NAVIGATING"]
            session["message"] = "Navigating to job posting…"
            logger.info("[%s] Navigating to %s", session_id, job_url)
            await page.goto(job_url, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(1.5)

            if abort_event.is_set():
                session["status"] = STATUS["ABORTED"]
                return

            # 2. Find Apply button
            found = await find_and_click_apply(page)
            if found:
                await asyncio.sleep(2)
                logger.info("[%s] Clicked Apply button", session_id)
            else:
                logger.info("[%s] No Apply button found — using current page", session_id)

            # Check for login wall immediately after clicking Apply
            if await detect_login_wall(page):
                session["screenshot"] = await screenshot_b64(page)
                session["status"] = STATUS["FAILED"]
                session["message"] = "Login required — this site needs you to sign in before applying. Auto-apply cannot proceed."
                logger.warning("[%s] Login wall detected", session_id)
                return

            # 3. Detect ATS iframe (Greenhouse, Lever, Workday embedded)
            frame = await get_active_frame(page)
            if frame is not page:
                session["message"] = "Detected embedded ATS form (Greenhouse/Lever)…"
                logger.info("[%s] Using ATS iframe frame", session_id)

            # 4. Multi-step form fill loop (max 5 steps)
            session["status"] = STATUS["FILLING"]
            session["message"] = "Analysing form fields…"

            for step in range(5):
                if abort_event.is_set():
                    session["status"] = STATUS["ABORTED"]
                    return

                await asyncio.sleep(1)
                # re-detect frame each step (Greenhouse paginates within iframe)
                frame = await get_active_frame(page)
                frame_url = getattr(frame, 'url', 'main-page')
                logger.info("[%s] Step %d: extracting from frame: %s", session_id, step, str(frame_url)[:80])
                fields = await extract_fields(frame)
                fillable = [f for f in fields if f["type"] not in ("file", "submit", "button", "reset")]
                logger.info("[%s] Step %d: %d total fields, %d fillable", session_id, step, len(fields), len(fillable))

                if not fillable:
                    logger.info("[%s] Step %d: no fillable fields — stopping loop", session_id, step)
                    break

                session["message"] = f"Filling {len(fillable)} fields (step {step + 1})…"
                logger.info("[%s] Step %d: %d fields", session_id, step, len(fillable))

                try:
                    values = llm_fill_values(fillable, job, prefs)
                    await fill_form(frame, values, fillable)
                except Exception as e:
                    logger.error("[%s] LLM fill error: %s", session_id, e)

                await asyncio.sleep(0.5)

                # Take screenshot after fill
                session["screenshot"] = await screenshot_b64(page)

                # Check for Next button — search in iframe first, fallback to page
                next_btn = await find_next_button(frame) if frame is not page else await find_next_button(page)
                if next_btn and await next_btn.is_visible():
                    try:
                        btn_text = (await next_btn.inner_text()).lower()
                    except Exception:
                        btn_text = ""
                    val = (await next_btn.get_attribute("value") or "").lower()
                    combined = btn_text or val
                    if any(w in combined for w in ("submit", "apply", "send application")):
                        # Final submit button found — stop, let user confirm
                        break
                    await next_btn.click(timeout=10000)
                    await asyncio.sleep(1.5)
                else:
                    break

            # 4. Final screenshot — await human confirm
            session["screenshot"] = await screenshot_b64(page)
            session["status"] = STATUS["AWAIT_CONFIRM"]
            session["message"] = "Review the form. Confirm to submit or abort."
            logger.info("[%s] Awaiting user confirm", session_id)

            # Wait up to 5 min for confirm or abort
            done, _ = await asyncio.wait(
                [
                    asyncio.create_task(confirm_event.wait()),
                    asyncio.create_task(abort_event.wait()),
                ],
                timeout=300,
                return_when=asyncio.FIRST_COMPLETED,
            )

            if abort_event.is_set() or not done:
                session["status"] = STATUS["ABORTED"]
                session["message"] = "Aborted." if abort_event.is_set() else "Timed out."
                return

            # 5. Submit
            session["status"] = STATUS["SUBMITTING"]
            session["message"] = "Submitting application…"
            logger.info("[%s] Submitting", session_id)

            frame = await get_active_frame(page)
            submit = await find_next_button(frame) if frame is not page else await find_next_button(page)
            if submit is None:
                submit = await find_next_button(page)
            if submit and await submit.is_visible():
                await submit.click(timeout=15000)
            else:
                await page.keyboard.press("Tab")
                await page.keyboard.press("Enter")

            # wait for navigation or DOM settle
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                await asyncio.sleep(3)

            session["screenshot"] = await screenshot_b64(page)

            # detect success — check main page AND any active iframe
            success_signals = [
                "thank you", "thanks for applying", "application submitted",
                "application received", "successfully applied", "we received your",
                "you have applied", "your application has been", "confirmation",
                "application complete",
            ]
            error_signals = [
                "required field", "please fix", "invalid entry",
                "something went wrong",
            ]

            main_text = ""
            all_text = ""
            try:
                main_text = (await page.inner_text("body")).lower()
                all_text = main_text
            except Exception:
                pass

            for frm in page.frames:
                if frm == page.main_frame:
                    continue
                try:
                    frm_text = (await frm.inner_text("body")).lower()
                    all_text += " " + frm_text
                    logger.info("Frame text (first 200): %s", frm_text[:200])
                except Exception:
                    pass

            # success can appear in any frame; errors only count in main page text
            confirmed = any(s in all_text for s in success_signals)
            has_error = any(s in main_text for s in error_signals)

            if confirmed:
                session["status"] = STATUS["SUBMITTED"]
                session["message"] = "Application submitted and confirmed. Check screenshot for details."
            elif has_error:
                session["status"] = STATUS["FAILED"]
                session["message"] = "Submit clicked but page shows errors. Check screenshot."
            else:
                session["status"] = STATUS["SUBMITTED"]
                session["message"] = "Submit clicked — check screenshot to verify confirmation. Email may follow shortly."

            logger.info("[%s] Post-submit: confirmed=%s has_error=%s", session_id, confirmed, has_error)

        except Exception as e:
            logger.error("[%s] Apply agent error: %s", session_id, e)
            try:
                session["screenshot"] = await screenshot_b64(page)
            except Exception:
                pass
            session["status"] = STATUS["FAILED"]
            session["error"] = str(e)
            session["message"] = f"Failed: {e}"
        finally:
            try:
                await context.close()
            except Exception:
                pass
            if browser:
                try:
                    await browser.close()
                except Exception:
                    pass


# ── browser-use based runner (universal, vision-capable) ────────────────────
def _build_candidate_brief(prefs: dict) -> str:
    name = prefs.get("name") or "Kiran Devihosur"
    email = prefs.get("email") or os.getenv("GMAIL_USER", "")
    return f"""
Name: {name}
Email: {email}
Phone: {prefs.get('phone') or ''}
Location: {prefs.get('location') or 'San Francisco, CA'}
Current/Target Role: {prefs.get('role') or ''}
Skills: {', '.join(prefs.get('skills', []))}
Years of Experience: {prefs.get('yoe') or '5'}
LinkedIn: {prefs.get('linkedin') or ''}
GitHub: {prefs.get('github') or ''}
Portfolio: {prefs.get('portfolio') or ''}
Bio/Summary: {prefs.get('resumeContext') or ''}

Authorization to work in US: Yes
Sponsorship needed: No
Willing to relocate: Yes
""".strip()


async def _take_session_screenshot(bsession, session: dict):
    try:
        page = await bsession.get_current_page()
        png = await page.screenshot(full_page=False)
        session["screenshot"] = base64.b64encode(png).decode()
    except Exception as e:
        logger.debug("screenshot failed: %s", e)


async def _run_apply_v2(session_id: str, job_url: str, job: dict, prefs: dict):
    """Universal apply runner using browser-use (vision + DOM hybrid)."""
    session = _sessions[session_id]
    confirm_event: asyncio.Event = session["_confirm_event"]
    abort_event: asyncio.Event = session["_abort_event"]

    try:
        from browser_use import Agent, BrowserProfile, BrowserSession
        from browser_use.llm import ChatOpenAI
    except ImportError as e:
        logger.error("browser-use not installed: %s — falling back to legacy", e)
        return await _run_apply(session_id, job_url, job, prefs)

    tk_key = os.getenv("TOKENROUTER_API_KEY")
    tk_url = os.getenv("TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1")
    if not tk_key:
        session["status"] = STATUS["FAILED"]
        session["message"] = "TOKENROUTER_API_KEY not configured"
        return

    # TokenRouter (OpenAI-compatible proxy → Anthropic). Anthropic rejects strict JSON
    # schema fields like `minimum`, `default`, `minItems` that browser-use auto-generates.
    # Workaround: skip forced structured output + inject schema into system prompt instead.
    llm = ChatOpenAI(
        model="anthropic/claude-sonnet-4.6",
        api_key=tk_key,
        base_url=tk_url,
        dont_force_structured_output=True,
        add_schema_to_system_prompt=True,
        remove_min_items_from_schema=True,
        remove_defaults_from_schema=True,
        temperature=0.2,
    )
    logger.info("Using TokenRouter ChatOpenAI (anthropic/claude-sonnet-4.6, schema-strict off)")

    candidate = _build_candidate_brief(prefs)
    fill_task = f"""You are filling out a job application on behalf of a candidate. Goal: navigate to the job URL, find the apply form, and fill EVERY field accurately. Stop just before submitting — the user will review.

JOB URL: {job_url}
JOB: {job.get('title', '')} at {job.get('company', '')}

CANDIDATE INFO:
{candidate}

INSTRUCTIONS:
1. Navigate to the job URL.
2. If there is an "Apply" / "Apply for this job" button, click it to open the application form.
3. Fill EVERY required form field with the appropriate candidate info.
4. For dropdowns, pick the option that best matches candidate info.
5. Demographic / EEO / diversity questions: choose "Decline to answer" or equivalent.
6. "How did you hear about us?" → "LinkedIn" or "Job Board".
7. Skip resume file upload fields — leave empty (user will handle manually).
8. Cover letter field: write a brief 3-sentence note based on the candidate's bio.
9. Multi-step forms: click Next/Continue until you reach the final review/submit page.
10. STOP at the final submit page. DO NOT click "Submit Application" / "Submit" / "Send".
11. When the form is filled and you see the submit button, call done(success=true).

If you hit a login wall, captcha, or cannot proceed, call done(success=false) with reason."""

    profile = BrowserProfile(
        headless=False,
        viewport={"width": 1280, "height": 900},
        user_data_dir=None,
    )
    bsession = BrowserSession(browser_profile=profile)
    session["_browser_session"] = bsession

    # Step callback: take screenshot + check abort
    async def step_cb(*args, **kwargs):
        await _take_session_screenshot(bsession, session)

    async def should_stop_cb(*args, **kwargs):
        return abort_event.is_set()

    try:
        session["status"] = STATUS["NAVIGATING"]
        session["message"] = "Starting browser-use agent…"
        logger.info("[%s] browser-use fill agent starting → %s", session_id, job_url)

        fill_agent = Agent(
            task=fill_task,
            llm=llm,
            browser_session=bsession,
            register_new_step_callback=step_cb,
            register_should_stop_callback=should_stop_cb,
            max_failures=3,
            use_vision=True,
            max_actions_per_step=3,
        )

        session["status"] = STATUS["FILLING"]
        await fill_agent.run(max_steps=40)

        if abort_event.is_set():
            session["status"] = STATUS["ABORTED"]
            session["message"] = "Aborted during fill."
            return

        await _take_session_screenshot(bsession, session)
        session["status"] = STATUS["AWAIT_CONFIRM"]
        session["message"] = "Form filled. Review the screenshot and confirm to submit."
        logger.info("[%s] Awaiting user confirm", session_id)

        done, _ = await asyncio.wait(
            [
                asyncio.create_task(confirm_event.wait()),
                asyncio.create_task(abort_event.wait()),
            ],
            timeout=300,
            return_when=asyncio.FIRST_COMPLETED,
        )

        if abort_event.is_set() or not done:
            session["status"] = STATUS["ABORTED"]
            session["message"] = "Aborted." if abort_event.is_set() else "Timed out."
            return

        # Submit phase — second agent runs on same browser session
        session["status"] = STATUS["SUBMITTING"]
        session["message"] = "Submitting application…"
        logger.info("[%s] Submit agent starting", session_id)

        submit_task = """Click the final submit button on the currently open application form.
The button is usually labeled "Submit Application", "Submit", "Send Application", or "Apply".
Wait for the page to confirm submission (look for "Thank you", "Application received", "Successfully applied" etc.).
Then call done(success=true).

If submission fails or you see validation errors, call done(success=false) with reason."""

        submit_agent = Agent(
            task=submit_task,
            llm=llm,
            browser_session=bsession,
            register_new_step_callback=step_cb,
            max_failures=2,
            use_vision=True,
            max_actions_per_step=2,
        )
        await submit_agent.run(max_steps=8)

        await _take_session_screenshot(bsession, session)

        # Verify success by reading page text
        try:
            page = await bsession.get_current_page()
            text = (await page.inner_text("body") or "").lower()
            success_signals = ["thank you", "application submitted", "application received",
                               "successfully applied", "we received your", "application complete"]
            if any(s in text for s in success_signals):
                session["status"] = STATUS["SUBMITTED"]
                session["message"] = "Submitted and confirmed."
            else:
                session["status"] = STATUS["SUBMITTED"]
                session["message"] = "Submit clicked — verify confirmation in screenshot."
        except Exception:
            session["status"] = STATUS["SUBMITTED"]
            session["message"] = "Submit clicked — check screenshot."

        logger.info("[%s] Apply complete: %s", session_id, session["status"])

    except Exception as e:
        logger.error("[%s] browser-use apply error: %s", session_id, e, exc_info=True)
        await _take_session_screenshot(bsession, session)
        session["status"] = STATUS["FAILED"]
        session["error"] = str(e)
        session["message"] = f"Failed: {e}"
    finally:
        try:
            await bsession.stop()
        except Exception:
            try:
                await bsession.kill()
            except Exception:
                pass


# ── endpoints ────────────────────────────────────────────────────────────────
@router.post("/start")
async def start_apply(req: ApplyRequest):
    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "status": STATUS["STARTING"],
        "screenshot": None,
        "message": "Starting browser…",
        "error": None,
        "_confirm_event": asyncio.Event(),
        "_abort_event": asyncio.Event(),
    }
    # Use browser-use based v2 runner (universal, robust). Falls back to legacy on import error.
    asyncio.create_task(_run_apply_v2(session_id, req.job_url, req.job, req.prefs))
    logger.info("Apply session started: %s", session_id)
    return {"session_id": session_id}


@router.get("/status/{session_id}")
async def apply_status(session_id: str):
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "status": s["status"],
        "message": s["message"],
        "screenshot": s["screenshot"],
        "error": s["error"],
    }


@router.post("/confirm")
async def confirm_apply(req: ConfirmRequest):
    s = _sessions.get(req.session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    if s["status"] != STATUS["AWAIT_CONFIRM"]:
        raise HTTPException(status_code=400, detail=f"Session not awaiting confirm (status: {s['status']})")
    s["_confirm_event"].set()
    return {"ok": True}


@router.post("/abort")
async def abort_apply(req: ConfirmRequest):
    s = _sessions.get(req.session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    s["_abort_event"].set()
    s["status"] = STATUS["ABORTED"]
    s["message"] = "Aborted by user."
    return {"ok": True}
