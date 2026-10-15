import sys, os
from deckkit import *
import slides_arch as A
import slides_content as Cn
import budget as B
from content import F, REFS

_HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = next(p for p in (os.path.join(_HERE, "assets"), os.path.join(_HERE, "..", "assets")) if os.path.isdir(p))

d = Deck()
Cn.slide_title(d, ASSETS)                                   # 1
A.slide_what(d)                                             # 2
Cn.slide_existing(d, F)                                     # 3
Cn.slide_chips(d, F)                                        # 4
Cn.slide_antenna(d, ASSETS)                                 # 5
A.slide_sync(d)                                             # 6
A.slide_clock(d, F)                                         # 7
A.slide_calnet(d, F)                                        # 8
A.slide_calloop(d)                                          # 9
Cn.slide_dataproblem(d, F)                                  # 10
Cn.slide_snapshots(d, F)                                    # 11
Cn.slide_options(d, F)                                      # 12
A.slide_tiles(d)                                            # 13
A.slide_onetile(d, F)                                       # 14
A.slide_dataflow(d, F)                                      # 15
Cn.slide_budget(d, F)                                       # 16
Cn.slide_modes(d, F)                                        # 17
Cn.slide_central_vs_tiled(d, F)                             # 18
Cn.slide_processors(d, F)                                   # 19
Cn.slide_beamforming(d, F)                                  # 20
Cn.slide_status_table(d, "Radar experiments", F["radar_source_line"], F["radar_rows"],
                      [0.6, 2.75, 4.4, 4.38], intro=F["radar_intro"], after=F["radar_after"],
                      row_heights=F.get("radar_row_heights"))  # 21
Cn.slide_status_table(d, "Communications experiments", F["comms_source_line"], F["comms_rows"],
                      [0.6, 3.0, 4.9, 3.63], intro=F["comms_intro"], row_heights=F.get("comms_row_heights"))  # 22
Cn.slide_status_table(d, "Transmit: what we know and what we don't", F["tx_source_line"], F["tx_rows"],
                      [0.6, 4.4, 7.13], intro=F["tx_intro"], after=F["tx_after"],
                      row_heights=F.get("tx_row_heights"))  # 23
Cn.slide_power(d, F)                                        # 24
A.slide_software(d)                                         # 25
Cn.slide_stages(d, F)                                       # 26
Cn.slide_risks(d, F)                                        # 27
Cn.slide_claims(d, F)                                       # 28
Cn.slide_bom(d, F)                                          # 29
Cn.slide_success(d, F)                                      # 30
half = (len(REFS) + 1) // 2
Cn.slide_refs(d, "References", REFS[:half])                 # 31
Cn.slide_refs(d, "References (continued)", REFS[half:], start=half + 1)     # 32
from notes_text import NOTES
assert len(NOTES) == d.n, (len(NOTES), d.n)
for sl, nt in zip(d.prs.slides, NOTES):
    notes(sl, nt)
import datetime as _dt
_cp = d.prs.core_properties
_cp.author = "ESP32-C5 phased-array project"
_cp.last_modified_by = ""
_cp.created = _cp.modified = _dt.datetime.now()
_cp.revision = 1
d.prs.core_properties.title = "ESP32-C5 4x4 phased-array research platform"
d.prs.core_properties.subject = "Student project proposal"
d.save(sys.argv[1])
print("slides:", d.n)
