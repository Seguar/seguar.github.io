import sys, os
from deckkit import *
import slides_arch as A
import slides_content as Cn
import slides_tile8 as T8
from content_v3 import F, REFS

_HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = next(p for p in (os.path.join(_HERE, "assets"), os.path.join(_HERE, "..", "assets")) if os.path.isdir(p))
d = Deck()
Cn.slide_title(d, ASSETS, F)            # 1
A.slide_what(d, F)                      # 2
Cn.slide_existing(d, F)                 # 3
Cn.slide_chips(d, F)                    # 4
Cn.slide_antenna(d, ASSETS, F)          # 5
A.slide_sync(d)                         # 6
T8.slide_domains(d, F)                  # 7
A.slide_clock(d, F)                     # 8
A.slide_calnet(d, F)                    # 9
A.slide_calloop(d)                      # 10
Cn.slide_dataproblem(d, F)              # 11
Cn.slide_snapshots(d, F)                # 12
Cn.slide_options(d, F)                  # 13
T8.slide_system(d, F)                   # 14
T8.slide_tile8(d, F)                    # 15
T8.slide_parlio_map(d, F)               # 16
T8.slide_modes2(d, F)                   # 17
Cn.slide_budget(d, F)                   # 18
A.slide_dataflow(d, F)                  # 19
T8.slide_planb(d, F)                    # 20
T8.slide_tile_pcb(d, F)                 # 21
Cn.slide_beamforming(d, F)              # 22
Cn.slide_status_table(d, "Radar experiments", F["radar_source_line"], F["radar_rows"],
                      [0.6, 2.75, 4.4, 4.38], after=F["radar_after"], row_heights=F.get("radar_row_heights"))  # 23
Cn.slide_status_table(d, "Communications experiments", F["comms_source_line"], F["comms_rows"],
                      [0.6, 3.0, 4.9, 3.63], row_heights=F.get("comms_row_heights"))  # 24
Cn.slide_status_table(d, "Transmit: what we know and what we don't", F["tx_source_line"], F["tx_rows"],
                      [0.6, 4.4, 7.13], after=F["tx_after"], row_heights=F.get("tx_row_heights"))  # 25
T8.slide_tx_steer(d, F)                 # 26
Cn.slide_power(d, F)                    # 27
T8.slide_cost(d, F)                     # 28
A.slide_software(d, F)                  # 29
T8.slide_bench(d, F)                    # 30
T8.slide_devseq(d, F)                   # 31
Cn.slide_risks(d, F)                    # 32
Cn.slide_claims(d, F)                   # 33
T8.slide_alternatives(d, F)             # 34
Cn.slide_success(d, F)                  # 35
half = (len(REFS) + 1) // 2
Cn.slide_refs(d, "References", REFS[:half])
Cn.slide_refs(d, "References (continued)", REFS[half:], start=half + 1)
try:
    from notes_v3 import NOTES
    assert len(NOTES) == d.n, (len(NOTES), d.n)
    for sl, nt in zip(d.prs.slides, NOTES):
        notes(sl, nt)
except ImportError:
    pass
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
