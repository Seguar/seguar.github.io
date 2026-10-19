# Deck and page generator

Python that builds the slide deck and the web page for the ESP32-C5 phased-array proposal.

- `build3.py` — builds the current deck (two 8-element tiles, 8 × 2-bit PARLIO → ESP32-S31 → 1 GbE)
- `build.py` — builds the earlier 4 × 2×2-tile version
- `site_build.py` — builds `index.html` (and `evidence.html` when given the research JSON files, which are not published here) from the same content files;
  without them it reads the claim counts the page quotes from the `evidence.html` already in the output folder, and stops if there is none
- `site_visual.py` — the page's figures and small HTML blocks (cards, stat tiles, Details blocks)
- `content.py`, `content_tile8.py`, `content_v3.py` — all slide text and numbers; `content_alt16.py` — the
  "Sixteen C5s on one board?" section of the page
- `notes_text.py`, `notes_v3.py` — speaker notes
- `slides_arch.py`, `slides_content.py`, `slides_tile8.py` — slide layouts and diagrams
- `tile3d.js`, `tile3d.css` — the interactive 3D tile viewer (three.js r128 from cdnjs), inlined into `index.html`;
  open the page with `?m3check=1` to run its layout check (clearances, RF over ground, equal path lengths)
- `deckkit.py` — drawing helpers; `budget.py` — rate and array-factor calculations
- `render.ps1` — renders each slide to PNG through PowerPoint (Windows)

```
pip install python-pptx lxml numpy pillow
python build3.py esp32_c5_phased_array_2x8_tiles.pptx
python site_build.py .. [<research folder with research_*.json>]   # into the page folder; evidence.html only with the research folder
```
