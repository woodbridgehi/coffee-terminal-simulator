from base64 import b64decode
from io import BytesIO
from pathlib import Path
import sys

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))

from backend import CoffeeDeviceRuntime


def test_order_qr_keeps_four_module_quiet_zone():
    data_url = CoffeeDeviceRuntime._qr_data_url("https://order.example.test/device/003")
    image = Image.open(BytesIO(b64decode(data_url.split(",", 1)[1]))).convert("RGB")
    non_white = ImageChops.difference(image, Image.new("RGB", image.size, "white")).getbbox()

    assert non_white is not None
    assert non_white[0] >= 40
    assert non_white[1] >= 40
    assert image.width - non_white[2] >= 40
    assert image.height - non_white[3] >= 40
    assert image.getpixel((non_white[0], non_white[1])) == (23, 56, 45)


def test_idle_qr_uses_brass_frame_and_four_green_markers():
    web_root = Path(__file__).resolve().parents[1] / "coffee-terminal" / "web"
    markup = (web_root / "index.html").read_text(encoding="utf-8")
    styles = (web_root / "styles.css").read_text(encoding="utf-8")

    assert markup.count('class="qr-position-marker ') == 4
    assert "border:1px solid var(--brass-300);border-radius:16px" in styles
    assert "border:2px solid var(--forest-700);border-radius:2px" in styles


def test_splash_lockup_viewbox_does_not_clip_qarm_wordmark():
    lockup = (
        Path(__file__).resolve().parents[1]
        / "coffee-terminal"
        / "web"
        / "assets"
        / "brand"
        / "qarm"
        / "co-brand-lockup.svg"
    ).read_text(encoding="utf-8")

    assert 'viewBox="0 0 440 64"' in lockup
