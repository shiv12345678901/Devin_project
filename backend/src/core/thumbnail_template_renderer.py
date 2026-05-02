"""Server-side renderer for the JSON thumbnail-template format.

This module is the Pillow counterpart to the React/Canvas renderer in
``frontend/src/lib/thumbnailBuilder.ts``. The frontend serialises the
editable thumbnail as a flat element tree:

    {
      "canvasWidth": 1920,
      "canvasHeight": 1080,
      "canvasBackground": "#4caf50",
      "elements": {
        "title": { "type": "title", "posX": ..., "text": "...", ... },
        ...
      }
    }

That same payload can be POSTed to ``/render-thumbnail-template`` and the
backend will produce a PNG that matches the editor preview pixel-for-pixel
(within the limits of font availability on the host).

The renderer is intentionally tolerant: missing keys fall back to sensible
defaults so the endpoint can be used as a public template renderer too,
not just as an internal parity check for the Flask pipeline.
"""
from __future__ import annotations

import io
import ipaddress
import math
import os
import re
import socket
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps


_IMAGE_TIMEOUT_SECONDS = 8
_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")


@dataclass(frozen=True)
class _Element:
    """Normalised view of a single template element.

    The dict-based JSON payload is converted to this typed view once so the
    renderer can stay focused on geometry/drawing instead of dict lookups.
    """

    id: str
    type: str
    pos_x: float
    pos_y: float
    width: float
    height: float
    z_index: int
    rotation: float
    opacity: float
    visible: bool
    text: str
    font_size: float
    font_weight: str
    font_family: str
    text_align: str
    color: str
    background_color: str
    border_color: str
    border_width: float
    border_radius: float
    padding_x: float
    padding_y: float
    image_url: str
    image_offset_x: float
    image_offset_y: float
    image_zoom: float
    image_fit_mode: str
    image_overlay: float
    shape_type: str


def render_template_png(payload: dict, pixel_ratio: float = 1.0) -> bytes:
    """Render the JSON thumbnail template into a PNG byte string."""
    width = max(64, int(payload.get("canvasWidth") or 1920))
    height = max(64, int(payload.get("canvasHeight") or 1080))
    background = _color(payload.get("canvasBackground"), "#ffffff")
    pixel_ratio = max(0.25, min(4.0, float(pixel_ratio or 1.0)))

    out_w = int(round(width * pixel_ratio))
    out_h = int(round(height * pixel_ratio))

    image = Image.new("RGBA", (out_w, out_h), background or "#ffffff")
    draw = ImageDraw.Draw(image, "RGBA")

    raw_elements = payload.get("elements") or {}
    if not isinstance(raw_elements, dict):
        raise ValueError("elements must be an object keyed by id")

    elements = [_normalise(eid, e) for eid, e in raw_elements.items() if isinstance(e, dict)]
    elements = [e for e in elements if e.visible]
    elements.sort(key=lambda e: e.z_index)

    for el in elements:
        _draw_element(image, draw, el, pixel_ratio)

    out = io.BytesIO()
    image.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


# ──────────────────────────── element normalisation ──────────────────────────


def _normalise(eid: str, raw: dict) -> _Element:
    return _Element(
        id=str(raw.get("id") or eid),
        type=str(raw.get("type") or "title"),
        pos_x=float(raw.get("posX") or 0),
        pos_y=float(raw.get("posY") or 0),
        width=float(raw.get("width") or 0),
        height=float(raw.get("height") or 0),
        z_index=int(raw.get("zIndex") or 5),
        rotation=float(raw.get("rotation") or 0),
        opacity=float(raw.get("opacity") if raw.get("opacity") is not None else 100),
        visible=raw.get("visible") is not False,
        text=str(raw.get("text") or ""),
        font_size=float(raw.get("fontSize") or 0),
        font_weight=str(raw.get("fontWeight") or "400"),
        font_family=str(raw.get("fontFamily") or ""),
        text_align=str(raw.get("textAlign") or "left"),
        color=str(raw.get("color") or "#000000"),
        background_color=str(raw.get("backgroundColor") or "transparent"),
        border_color=str(raw.get("borderColor") or "transparent"),
        border_width=float(raw.get("borderWidth") or 0),
        border_radius=float(raw.get("borderRadius") or 0),
        padding_x=float(raw.get("paddingX") or 0),
        padding_y=float(raw.get("paddingY") or 0),
        image_url=str(raw.get("imageUrl") or ""),
        image_offset_x=float(
            raw.get("imageOffsetX") if raw.get("imageOffsetX") is not None else 50
        ),
        image_offset_y=float(
            raw.get("imageOffsetY") if raw.get("imageOffsetY") is not None else 50
        ),
        image_zoom=float(
            raw.get("imageZoom") if raw.get("imageZoom") is not None else 100
        ),
        image_fit_mode=str(raw.get("imageFitMode") or "cover"),
        image_overlay=float(raw.get("imageOverlay") or 0),
        shape_type=str(raw.get("shapeType") or "rectangle"),
    )


# ──────────────────────────── drawing dispatch ───────────────────────────────


def _draw_element(
    image: Image.Image, draw: ImageDraw.ImageDraw, el: _Element, ratio: float
) -> None:
    if el.type == "image":
        _draw_image_element(image, el, ratio)
        return
    if el.type in ("panel", "shape"):
        _draw_shape(draw, el, ratio)
        return
    if el.type == "badge":
        _draw_badge(image, draw, el, ratio)
        return
    _draw_text_box(image, draw, el, ratio)


def _draw_shape(draw: ImageDraw.ImageDraw, el: _Element, ratio: float) -> None:
    x0, y0, x1, y1 = _scaled_box(el, ratio)
    fill = _color(el.background_color, None)
    border = _color(el.border_color, None)
    bw = max(0, int(round(el.border_width * ratio)))
    radius = int(round(el.border_radius * ratio))

    if el.shape_type == "circle":
        draw.ellipse((x0, y0, x1, y1), fill=fill, outline=border, width=bw or 0)
    elif el.shape_type == "pill":
        r = max(1, min((x1 - x0), (y1 - y0)) // 2)
        draw.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=fill, outline=border, width=bw)
    elif el.shape_type == "line":
        if border:
            mid = (y0 + y1) // 2
            draw.line((x0, mid, x1, mid), fill=border, width=max(2, bw))
    else:
        if radius > 0:
            draw.rounded_rectangle((x0, y0, x1, y1), radius=radius, fill=fill, outline=border, width=bw)
        else:
            draw.rectangle((x0, y0, x1, y1), fill=fill, outline=border, width=bw)


def _draw_text_box(
    image: Image.Image, draw: ImageDraw.ImageDraw, el: _Element, ratio: float
) -> None:
    x0, y0, x1, y1 = _scaled_box(el, ratio)
    bw = max(0, int(round(el.border_width * ratio)))
    radius = int(round(el.border_radius * ratio))
    fill = _color(el.background_color, None)
    border = _color(el.border_color, None)

    if fill or border:
        if radius > 0:
            draw.rounded_rectangle((x0, y0, x1, y1), radius=radius, fill=fill, outline=border, width=bw)
        else:
            draw.rectangle((x0, y0, x1, y1), fill=fill, outline=border, width=bw)

    if not el.text:
        return

    needs_devanagari = _DEVANAGARI_RE.search(el.text) is not None
    pad_x = int(round(el.padding_x * ratio))
    pad_y = int(round(el.padding_y * ratio))
    inner_w = max(1, x1 - x0 - 2 * pad_x)
    inner_h = max(1, y1 - y0 - 2 * pad_y)

    lines = el.text.split("\n")
    font_size = max(8, int(round(el.font_size * ratio)))
    min_size = max(8, int(round(font_size * 0.4)))
    bold = _is_bold(el.font_weight)

    # Auto-shrink: same heuristic as the canvas renderer — drop 2 px at a
    # time until the widest line + total height fits the inner box.
    while font_size > min_size:
        font = _font(font_size, bold=bold, prefer_devanagari=needs_devanagari)
        widest = max((_measure(draw, line, font)[0] for line in lines), default=0)
        line_height = font_size * 1.08
        total_height = line_height * len(lines)
        if widest <= inner_w and total_height <= inner_h:
            break
        font_size -= 2
    font = _font(font_size, bold=bold, prefer_devanagari=needs_devanagari)
    line_height = font_size * 1.08
    total_height = line_height * len(lines)

    text_color = _color(el.color, "#000000") or "#000000"
    align = el.text_align if el.text_align in ("left", "center", "right") else "left"

    cy = y0 + pad_y + max(0, (inner_h - total_height) / 2)
    for index, line in enumerate(lines):
        line_w, _ = _measure(draw, line, font)
        if align == "right":
            tx = x1 - pad_x - line_w
        elif align == "center":
            tx = x0 + pad_x + (inner_w - line_w) / 2
        else:
            tx = x0 + pad_x
        ty = cy + index * line_height
        draw.text((tx, ty), line, font=font, fill=text_color)


def _draw_image_element(image: Image.Image, el: _Element, ratio: float) -> None:
    x0, y0, x1, y1 = _scaled_box(el, ratio)
    box_w = max(1, x1 - x0)
    box_h = max(1, y1 - y0)
    radius = int(round(el.border_radius * ratio))

    photo: Image.Image | None = _fetch_image(el.image_url) if el.image_url else None
    if photo is None:
        photo = _placeholder_image(box_w, box_h)
    else:
        photo = photo.convert("RGB")
        zoom = max(0.1, el.image_zoom / 100.0)
        # Same fit-mode logic as the canvas renderer:
        #  * cover (default) — scale so the box is fully covered, may crop
        #  * contain — scale so the whole image fits, may letterbox
        #  * stretch — ignore aspect ratio, fill the box exactly
        if el.image_fit_mode == "stretch":
            new_w = max(1, int(round(box_w * zoom)))
            new_h = max(1, int(round(box_h * zoom)))
        elif el.image_fit_mode == "contain":
            scale = min(box_w / photo.width, box_h / photo.height) * zoom
            new_w = max(1, int(round(photo.width * scale)))
            new_h = max(1, int(round(photo.height * scale)))
        else:
            scale = max(box_w / photo.width, box_h / photo.height) * zoom
            new_w = max(1, int(round(photo.width * scale)))
            new_h = max(1, int(round(photo.height * scale)))
        photo = photo.resize((new_w, new_h), Image.Resampling.LANCZOS)
        offset_x = int((el.image_offset_x / 100.0) * (box_w - new_w))
        offset_y = int((el.image_offset_y / 100.0) * (box_h - new_h))
        canvas = Image.new("RGB", (box_w, box_h), _color(el.background_color, "#111111") or "#111111")
        canvas.paste(photo, (offset_x, offset_y))
        photo = canvas

    # Round corners using a mask, then drop the result onto the canvas.
    mask = Image.new("L", (box_w, box_h), 0)
    mdraw = ImageDraw.Draw(mask)
    if radius > 0:
        mdraw.rounded_rectangle((0, 0, box_w, box_h), radius=radius, fill=255)
    else:
        mdraw.rectangle((0, 0, box_w, box_h), fill=255)
    image.paste(photo, (x0, y0), mask)

    if el.image_overlay > 0:
        overlay = Image.new("RGBA", (box_w, box_h), (15, 23, 42, 0))
        odraw = ImageDraw.Draw(overlay)
        steps = 12
        for i in range(steps):
            top_alpha = (el.image_overlay / 100.0) * 0.2
            bot_alpha = (el.image_overlay / 100.0) * 0.85
            t = i / max(1, steps - 1)
            alpha = int(255 * (top_alpha + (bot_alpha - top_alpha) * t))
            y = int(box_h * t)
            y_next = int(box_h * ((i + 1) / steps))
            odraw.rectangle((0, y, box_w, y_next), fill=(15, 23, 42, alpha))
        if radius > 0:
            overlay_mask = Image.new("L", (box_w, box_h), 0)
            ImageDraw.Draw(overlay_mask).rounded_rectangle(
                (0, 0, box_w, box_h), radius=radius, fill=255
            )
            image.paste(overlay, (x0, y0), overlay_mask)
        else:
            image.paste(overlay, (x0, y0), overlay)


def _draw_badge(
    image: Image.Image, draw: ImageDraw.ImageDraw, el: _Element, ratio: float
) -> None:
    x0, y0, x1, y1 = _scaled_box(el, ratio)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    w = max(1, x1 - x0)
    h = max(1, y1 - y0)
    radius = max(0, int(round(el.border_radius * ratio)))
    fill = _color(el.background_color, "#ffee00") or "#ffee00"

    if radius >= min(w, h) // 2 and radius > 0:
        draw.ellipse((x0, y0, x1, y1), fill=fill)
    elif radius > 0:
        draw.rounded_rectangle((x0, y0, x1, y1), radius=radius, fill=fill)
    else:
        # Starburst — same 14-point shape as the canvas renderer.
        outer_r = min(w, h) / 2
        inner_r = outer_r * 0.78
        points = []
        for i in range(28):
            angle = math.pi * i / 14 - math.pi / 2
            r = outer_r if i % 2 == 0 else inner_r
            points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
        draw.polygon(points, fill=fill)

    if not el.text:
        return

    needs_devanagari = _DEVANAGARI_RE.search(el.text) is not None
    bold = _is_bold(el.font_weight)
    font_size = max(8, int(round(el.font_size * ratio)))
    font = _font(font_size, bold=bold, prefer_devanagari=needs_devanagari)
    text_color = _color(el.color, "#0f172a") or "#0f172a"

    lines = el.text.split("\n")
    line_h = font_size * 1.1
    total_h = line_h * len(lines)
    for index, line in enumerate(lines):
        lw, _ = _measure(draw, line, font)
        tx = cx - lw / 2
        ty = cy - total_h / 2 + index * line_h
        draw.text((tx, ty), line, font=font, fill=text_color)


# ──────────────────────────── colour / font helpers ──────────────────────────


def _scaled_box(el: _Element, ratio: float) -> tuple[int, int, int, int]:
    x0 = int(round(el.pos_x * ratio))
    y0 = int(round(el.pos_y * ratio))
    x1 = int(round((el.pos_x + el.width) * ratio))
    y1 = int(round((el.pos_y + el.height) * ratio))
    return x0, y0, x1, y1


def _color(value: str | None, fallback: str | None) -> str | None:
    """Normalise a CSS-ish colour string into something Pillow understands."""
    if not value:
        return fallback
    s = value.strip()
    if not s or s.lower() == "transparent":
        return None
    if s.startswith("#"):
        return s
    if s.startswith("rgb("):
        match = re.match(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", s)
        if match:
            r, g, b = (int(v) for v in match.groups())
            return f"#{r:02x}{g:02x}{b:02x}"
    if s.startswith("rgba("):
        match = re.match(
            r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)", s
        )
        if match:
            r, g, b = (int(v) for v in match.groups()[:3])
            return f"#{r:02x}{g:02x}{b:02x}"
    # Named colours — let Pillow validate them.
    return s


def _is_bold(weight: str) -> bool:
    try:
        return int(weight) >= 600
    except (TypeError, ValueError):
        return weight.lower() in {"bold", "bolder", "black"}


def _measure(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    if not text:
        return (0, 0)
    bbox = draw.textbbox((0, 0), text, font=font)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1])


def _font(size: int, *, bold: bool, prefer_devanagari: bool):
    """Pick the best installed font for the given script + weight."""
    devanagari_candidates = (
        os.environ.get("THUMBNAIL_FONT_DEVANAGARI") or "",
        "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf"
        if bold else "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
        "/usr/share/fonts/truetype/Tiro_Devanagari_Sanskrit/TiroDevanagariSanskrit-Regular.ttf",
        r"C:\Windows\Fonts\mangalb.ttf" if bold else r"C:\Windows\Fonts\mangal.ttf",
        r"C:\Windows\Fonts\Nirmala.ttc",
    )
    latin_candidates: Iterable[str] = (
        os.environ.get("THUMBNAIL_FONT_PATH") or "",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
        if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    )
    sources = (
        list(devanagari_candidates) + list(latin_candidates)
        if prefer_devanagari
        else list(latin_candidates) + list(devanagari_candidates)
    )
    for path in sources:
        if path and os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


# ──────────────────────────── image fetch helpers ────────────────────────────


def _fetch_image(url: str) -> Image.Image | None:
    """Best-effort, SSRF-safe HTTP image download."""
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if _is_private_host(parsed.hostname or ""):
        return None
    try:
        response = requests.get(url, timeout=_IMAGE_TIMEOUT_SECONDS, stream=True)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if content_type and not content_type.lower().startswith("image/"):
            return None
        data = bytearray()
        for chunk in response.iter_content(64 * 1024):
            data.extend(chunk)
            if len(data) > _MAX_IMAGE_BYTES:
                return None
        return Image.open(io.BytesIO(data))
    except Exception:
        return None


def _is_private_host(hostname: str) -> bool:
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except OSError:
        return True
    for addr in addresses:
        ip = ipaddress.ip_address(addr[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
            return True
    return False


def _placeholder_image(width: int, height: int) -> Image.Image:
    """Plain neutral placeholder used when the side image URL is missing."""
    image = Image.new("RGB", (width, height), "#cbd5e1")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, height), fill="#cbd5e1")
    inset = max(8, min(width, height) // 12)
    draw.rounded_rectangle(
        (inset, inset, width - inset, height - inset),
        radius=max(4, inset // 2),
        fill="#94a3b8",
    )
    return ImageOps.autocontrast(image)
