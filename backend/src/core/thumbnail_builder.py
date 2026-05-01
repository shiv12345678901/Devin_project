"""Public PNG thumbnail renderer.

The model mirrors the React editor style: a fixed-size canvas plus
absolutely-positioned elements. Pillow renders that model directly for the
public Flask endpoint.
"""
from __future__ import annotations

import io
import ipaddress
import os
import socket
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps


CANVAS_SIZE = (1920, 1080)
_IMAGE_TIMEOUT_SECONDS = 8
_MAX_IMAGE_BYTES = 12 * 1024 * 1024


@dataclass(frozen=True)
class ThumbnailParams:
    class_name: str
    chapter_num: str
    chapter_title: str
    chapter_title2: str = ""
    image_url: str = ""
    year: str = "2082"
    template: str = "default"


def render_thumbnail_png(params: ThumbnailParams) -> bytes:
    """Render a 1920x1080 PNG for query-string driven thumbnail requests."""

    base = Image.new("RGB", CANVAS_SIZE, "#f4c400")
    draw = ImageDraw.Draw(base)

    photo = _fetch_image(params.image_url)
    if photo is None:
        photo = _placeholder_image()
    photo = ImageOps.fit(photo.convert("RGB"), (760, 760), method=Image.Resampling.LANCZOS)
    base.paste(photo, (1050, 160))

    _draw_decor(base, draw)
    _draw_text_layout(draw, params)

    out = io.BytesIO()
    base.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _draw_decor(base: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    draw.rounded_rectangle((90, 110, 975, 910), radius=28, fill="#fff3c4")
    draw.rounded_rectangle((110, 130, 955, 890), radius=22, outline="#ef4444", width=8)
    draw.rectangle((0, 0, CANVAS_SIZE[0], 70), fill="#e11d48")
    draw.rectangle((0, CANVAS_SIZE[1] - 70, CANVAS_SIZE[0], CANVAS_SIZE[1]), fill="#e11d48")
    draw.polygon([(990, 120), (1840, 120), (1770, 930), (1030, 930)], fill="#dc2626")
    draw.polygon([(1030, 150), (1800, 150), (1735, 900), (1070, 900)], fill="#991b1b")

    mask = Image.new("L", CANVAS_SIZE, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((1040, 150, 1820, 930), radius=34, fill=255)
    shadow = Image.new("RGB", CANVAS_SIZE, "#7f1d1d")
    base.paste(shadow, mask=mask.point(lambda p: int(p * 0.25)))


def _draw_text_layout(draw: ImageDraw.ImageDraw, params: ThumbnailParams) -> None:
    font_bold = _font(86, bold=True)
    font_title = _font(116, bold=True)
    font_title2 = _font(104, bold=True)
    font_badge = _font(54, bold=True)
    font_small = _font(44, bold=True)

    draw.rounded_rectangle((145, 175, 450, 270), radius=18, fill="#dc2626")
    draw.text((178, 194), f"Class {params.class_name}", font=font_badge, fill="#ffffff")

    draw.rounded_rectangle((520, 175, 910, 270), radius=18, fill="#111827")
    draw.text((555, 194), f"Year {params.year}", font=font_badge, fill="#ffffff")

    draw.text((150, 350), f"Chapter {params.chapter_num}", font=font_bold, fill="#111827")
    _center_text(draw, params.chapter_title, (140, 460, 930, 600), font_title, "#dc2626")
    if params.chapter_title2:
        _center_text(draw, params.chapter_title2, (140, 610, 930, 750), font_title2, "#dc2626")

    draw.rounded_rectangle((200, 785, 875, 865), radius=18, fill="#dc2626")
    _center_text(draw, "Complete Nepali Guide", (200, 792, 875, 858), font_small, "#ffffff")


def _center_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: str,
) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    x = box[0] + ((box[2] - box[0]) - width) / 2
    y = box[1] + ((box[3] - box[1]) - height) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates: Iterable[str] = (
        os.environ.get("THUMBNAIL_FONT_PATH") or "",
        r"C:\Windows\Fonts\mangalb.ttf" if bold else r"C:\Windows\Fonts\mangal.ttf",
        r"C:\Windows\Fonts\Nirmala.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf" if bold else "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    )
    for path in candidates:
        if path and os.path.isfile(path):
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _fetch_image(url: str) -> Image.Image | None:
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


def _placeholder_image() -> Image.Image:
    image = Image.new("RGB", (760, 760), "#fde68a")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((70, 70, 690, 690), radius=44, fill="#f97316")
    draw.ellipse((210, 150, 550, 490), fill="#fff7ed")
    draw.rectangle((170, 520, 590, 620), fill="#fff7ed")
    return image
