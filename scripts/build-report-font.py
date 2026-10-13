"""Create a PDF-compatible static instance of HALO's existing licensed font."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
font = TTFont(root / "public/fonts/instrument-sans-latin.woff2")
if "fvar" in font:
    font = instantiateVariableFont(font, {"wght": 450}, inplace=True)
font.flavor = None
font.save(root / "public/fonts/instrument-sans-report.ttf")
print("Created static Instrument Sans report font. License: public/fonts/InstrumentSans-OFL.txt")
