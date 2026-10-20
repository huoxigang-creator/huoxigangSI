"""Create non-payable layout fixtures. No QR payload, account number, or real customer data."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

directory = Path(__file__).resolve().parent
font_path = "C:/Windows/Fonts/msyh.ttc"


def font(size):
    return ImageFont.truetype(font_path, size)


def create(name, width, height, image_format):
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((16, 16, width - 17, height - 17), outline="#B91C1C", width=8)
    draw.text((width / 2, 60), "演示图片 · 不可付款", font=font(38), fill="#B91C1C", anchor="mt")
    draw.text((width / 2, 118), "DEMO - CANNOT PAY", font=font(28), fill="#B91C1C", anchor="mt")
    side = min(width - 180, height - 300)
    left, top = (width - side) / 2, (height - side) / 2 + 25
    draw.rectangle((left, top, left + side, top + side), fill="#F1F5F9", outline="#94A3B8", width=4)
    draw.line((left + 24, top + 24, left + side - 24, top + side - 24), fill="#DC2626", width=18)
    draw.line((left + side - 24, top + 24, left + 24, top + side - 24), fill="#DC2626", width=18)
    draw.rectangle((left + 25, top + side / 2 - 45, left + side - 25, top + side / 2 + 45), fill="white")
    draw.text((width / 2, top + side / 2), "没有付款功能", font=font(36), fill="#B91C1C", anchor="mm")
    draw.text((width / 2, height - 60), "仅用于验证图片比例与 PDF 排版", font=font(26), fill="#475569", anchor="mm")
    image.save(directory / name, image_format, quality=95)


create("payment-code-demo.png", 720, 960, "PNG")
create("payment-code-demo.jpg", 960, 640, "JPEG")
