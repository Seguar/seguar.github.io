"""Data-rate budget numbers used on several slides (single source of truth)."""
import numpy as np

C0 = 299_792_458.0
F0 = 5.2e9
LAM = C0 / F0                 # m
D = LAM / 2                   # element pitch
N_EL = 16
N_TILE = 2                    # two 8-element tiles (the earlier deck, build.py, had four 2×2 tiles)

FS = 80e6                     # complex samples/s inside the chip (upper bound)
BITS = 16                     # 8-bit I + 8-bit Q


def raw_rate(fs=FS, n=1, bits=BITS):
    return fs * bits * n      # bit/s


def fmt_rate(bps):
    if bps >= 1e9:
        v, u = bps / 1e9, "Gbit/s"
    elif bps >= 1e6:
        v, u = bps / 1e6, "Mbit/s"
    elif bps >= 1e3:
        v, u = bps / 1e3, "kbit/s"
    else:
        v, u = bps, "bit/s"
    s = f"{v:.3g}" if v < 100 else f"{v:.0f}"
    return f"{s} {u}"


def fmt_bytes(b):
    if b >= 1 << 20:
        return f"{b / (1 << 20):.3g} MiB"
    if b >= 1 << 10:
        return f"{b / (1 << 10):.3g} KiB"
    return f"{b:.0f} B"


def array_factor_db(n, steer_deg, theta_deg, d_over_lam=0.5, floor=-40):
    th = np.radians(theta_deg)
    k = 2 * np.pi * d_over_lam
    psi = k * (np.sin(th) - np.sin(np.radians(steer_deg)))
    m = np.arange(n)[:, None]
    af = np.abs(np.exp(1j * m * psi).sum(axis=0)) / n
    return np.maximum(20 * np.log10(np.maximum(af, 1e-6)), floor)


if __name__ == "__main__":
    print("lambda", LAM * 1e3, "mm  d", D * 1e3, "mm")
    print("raw per element", fmt_rate(raw_rate()))
    print("raw array", fmt_rate(raw_rate(n=16)))
