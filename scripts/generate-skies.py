"""Procedural equirectangular sky panoramas for the Oasis.

Writes, per sky id, into public/skies/:
  <id>.jpg      4096x2048 background, display-referred sRGB (what you see)
  <id>_env.hdr  1024x512 Radiance RGBE, linear, used for image-based lighting
                (same sky, scaled to the brightness of the bundled HDRIs, with
                the sun/moon added as a real light source)

Every pixel is shaded from its 3D view direction (three.js equirect convention:
u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5, y up), so the left/right
seam is continuous and nothing pinches at the poles.

Usage (numpy, Pillow, scipy):
  python scripts/generate-skies.py                    # all skies, full size
  python scripts/generate-skies.py clear_day --preview # 1024x512 quick look
  python scripts/generate-skies.py --views out_dir     # + perspective previews
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "skies"
F = np.float32
TAU = 2.0 * math.pi


# ─── colour helpers ──────────────────────────────────────────────────────────

def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def C(r, g, b):
    """sRGB 0-255 triple -> linear float32 array."""
    return srgb_to_linear(np.array([r, g, b], dtype=np.float64) / 255.0).astype(F)


_LMS = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                 [0.2119034982, 0.6806995451, 0.1073969566],
                 [0.0883024619, 0.2817188376, 0.6299787005]])
_LAB = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                 [1.9779984951, -2.4285922050, 0.4505937099],
                 [0.0259040371, 0.7827717662, -0.8086757660]])
_LMS_INV = np.linalg.inv(_LMS)
_LAB_INV = np.linalg.inv(_LAB)


def lin_to_oklab(c):
    return np.cbrt(np.asarray(c, np.float64) @ _LMS.T) @ _LAB.T


def oklab_to_lin(lab):
    return (np.asarray(lab, np.float64) @ _LAB_INV.T) ** 3 @ _LMS_INV.T


def ramp(t, stops):
    """Piecewise gradient through (position, linear colour) stops, interpolated
    in OKLab so hue transitions stay clean. t: (N,) -> (N, 3) linear."""
    pos = np.array([s[0] for s in stops], np.float64)
    lab = lin_to_oklab(np.array([s[1] for s in stops], np.float64))
    t = np.clip(np.asarray(t, np.float64), pos[0], pos[-1])
    out = np.stack([np.interp(t, pos, lab[:, k]) for k in range(3)], -1)
    return np.maximum(oklab_to_lin(out), 0.0).astype(F)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mix(a, b, t):
    t = np.asarray(t)
    if t.ndim == 1:
        t = t[:, None]
    return a + (b - a) * t


def over(base, color, alpha):
    """Alpha-composite colour over base. alpha: (N,)"""
    return base * (1.0 - alpha[:, None]) + color * alpha[:, None]


# ─── geometry ────────────────────────────────────────────────────────────────

def direction(lon_deg, el_deg):
    lon, el = math.radians(lon_deg), math.radians(el_deg)
    return np.array([math.cos(el) * math.cos(lon), math.sin(el), math.cos(el) * math.sin(lon)], np.float64)


def pixel_dirs(W, H, r0, r1):
    """Unit view directions for rows r0..r1 of a WxH equirect (row 0 = top)."""
    lon = ((np.arange(W) + 0.5) / W - 0.5) * TAU
    el = (0.5 - (np.arange(r0, r1) + 0.5) / H) * math.pi
    lon, el = np.meshgrid(lon, el)
    ce = np.cos(el)
    d = np.stack([ce * np.cos(lon), np.sin(el), ce * np.sin(lon)], -1).reshape(-1, 3)
    return d, lon.reshape(-1), el.reshape(-1)


def tangent_frame(center):
    """east/north unit vectors on the sky around a direction."""
    up = np.array([0.0, 1.0, 0.0])
    east = np.cross(up, center)
    if np.linalg.norm(east) < 1e-6:
        east = np.array([1.0, 0.0, 0.0])
    east /= np.linalg.norm(east)
    north = np.cross(center, east)
    return east, north


# ─── noise ───────────────────────────────────────────────────────────────────

def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


class Perlin:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256).astype(np.int64)
        self.p = np.concatenate([p, p, p])
        ang = rng.uniform(0.0, TAU, 256)
        self.g2 = np.stack([np.cos(ang), np.sin(ang)], 1).astype(F)
        g3 = rng.normal(size=(256, 3))
        self.g3 = (g3 / np.linalg.norm(g3, axis=1, keepdims=True)).astype(F)

    def n2(self, x, y):
        xf, yf = np.floor(x), np.floor(y)
        xi, yi = xf.astype(np.int64) & 255, yf.astype(np.int64) & 255
        fx, fy = (x - xf).astype(F), (y - yf).astype(F)
        u, v = _fade(fx), _fade(fy)
        p, g = self.p, self.g2
        a, b = p[xi] + yi, p[xi + 1] + yi
        h00, h01, h10, h11 = p[a], p[a + 1], p[b], p[b + 1]
        n00 = g[h00, 0] * fx + g[h00, 1] * fy
        n10 = g[h10, 0] * (fx - 1) + g[h10, 1] * fy
        n01 = g[h01, 0] * fx + g[h01, 1] * (fy - 1)
        n11 = g[h11, 0] * (fx - 1) + g[h11, 1] * (fy - 1)
        x0 = n00 + u * (n10 - n00)
        x1 = n01 + u * (n11 - n01)
        return (x0 + v * (x1 - x0)) * F(1.4)

    def n3(self, x, y, z):
        xf, yf, zf = np.floor(x), np.floor(y), np.floor(z)
        xi, yi, zi = (xf.astype(np.int64) & 255, yf.astype(np.int64) & 255, zf.astype(np.int64) & 255)
        fx, fy, fz = (x - xf).astype(F), (y - yf).astype(F), (z - zf).astype(F)
        u, v, w = _fade(fx), _fade(fy), _fade(fz)
        p, g = self.p, self.g3

        def corner(dx, dy, dz):
            h = p[p[p[xi + dx] + yi + dy] + zi + dz]
            return g[h, 0] * (fx - dx) + g[h, 1] * (fy - dy) + g[h, 2] * (fz - dz)

        x00 = corner(0, 0, 0) + u * (corner(1, 0, 0) - corner(0, 0, 0))
        x10 = corner(0, 1, 0) + u * (corner(1, 1, 0) - corner(0, 1, 0))
        x01 = corner(0, 0, 1) + u * (corner(1, 0, 1) - corner(0, 0, 1))
        x11 = corner(0, 1, 1) + u * (corner(1, 1, 1) - corner(0, 1, 1))
        y0 = x00 + v * (x10 - x00)
        y1 = x01 + v * (x11 - x01)
        return (y0 + w * (y1 - y0)) * F(1.5)

    def fbm2(self, x, y, octaves=5, lac=2.0, gain=0.5, footprint=None):
        """fbm with per-pixel octave fade when a pixel covers more than a
        wavelength (footprint in input units), which keeps distant cloud decks
        from turning into moire noise."""
        total = np.zeros(np.shape(x), F)
        amp, freq = 1.0, 1.0
        ca, sa = math.cos(0.61), math.sin(0.61)
        for o in range(octaves):
            n = self.n2(x * freq + 17.3 * o, y * freq - 9.1 * o)
            if footprint is not None:
                n = n * (1.0 - smoothstep(0.25, 0.7, footprint * freq)).astype(F)
            total += F(amp) * n
            x, y = x * ca - y * sa, x * sa + y * ca
            amp *= gain
            freq *= lac
        return total

    def fbm3(self, x, y, z, octaves=5, lac=2.0, gain=0.5):
        total = np.zeros(np.shape(x), F)
        amp, freq = 1.0, 1.0
        for o in range(octaves):
            total += F(amp) * self.n3(x * freq + 11.7 * o, y * freq - 5.3 * o, z * freq + 3.1 * o)
            amp *= gain
            freq *= lac
        return total


def circle_noise(per, lon, radius, octaves=4, ridged=False, seed_off=0.0):
    """Noise that is periodic in longitude: sample 2D noise on a circle."""
    x = np.cos(lon) * radius + 50.0 + seed_off
    y = np.sin(lon) * radius - 30.0
    if not ridged:
        return per.fbm2(x, y, octaves)
    total = np.zeros(np.shape(lon), F)
    amp, freq = 1.0, 1.0
    for o in range(octaves):
        total += F(amp) * (1.0 - np.abs(per.n2(x * freq + 7.0 * o, y * freq)))
        amp *= 0.5
        freq *= 2.0
    return total


# ─── stars ───────────────────────────────────────────────────────────────────

def random_dirs(rng, n):
    v = rng.normal(size=(n, 3))
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def splat(img, dirs, rgb, sigma_px, flare=0.0):
    """Add point lights as gaussians measured in true angular distance.
    img: (H, W, 3) linear. dirs (N,3), rgb (N,3) peak linear colour.
    flare > 0 adds a 4-point glint (synthwave stars)."""
    H, W, _ = img.shape
    pix = math.pi / H
    lon = np.arctan2(dirs[:, 2], dirs[:, 0])
    el = np.arcsin(np.clip(dirs[:, 1], -1, 1))
    cx = (lon / TAU + 0.5) * W - 0.5
    cy = (0.5 - el / math.pi) * H - 0.5
    R = int(math.ceil(3.5 * sigma_px + (12 * flare if flare else 0)))
    rx = np.minimum(np.ceil(R / np.maximum(np.cos(el), 0.02)).astype(int), W // 2)
    flat = img.reshape(-1, 3)
    for rxv in np.unique(rx):
        sel = np.where(rx == rxv)[0]
        dy, dx = np.meshgrid(np.arange(-R, R + 1), np.arange(-rxv, rxv + 1), indexing="ij")
        dy, dx = dy.reshape(-1), dx.reshape(-1)
        iy = np.clip(np.round(cy[sel])[:, None].astype(int) + dy[None], 0, H - 1)
        ix = (np.round(cx[sel])[:, None].astype(int) + dx[None]) % W
        plon = ((ix + 0.5) / W - 0.5) * TAU
        pel = (0.5 - (iy + 0.5) / H) * math.pi
        ce = np.cos(pel)
        pd = np.stack([ce * np.cos(plon), np.sin(pel), ce * np.sin(plon)], -1)
        sd = dirs[sel][:, None, :]
        chord = np.linalg.norm(pd - sd, axis=-1)
        ang = 2.0 * np.arcsin(np.clip(chord / 2.0, 0, 1)) / pix
        w = np.exp(-0.5 * (ang / sigma_px) ** 2)
        if flare:
            dl = np.angle(np.exp(1j * (plon - lon[sel][:, None]))) * np.cos(el[sel])[:, None] / pix
            de = (pel - el[sel][:, None]) / pix
            spike = np.exp(-0.5 * ((dl / (9 * flare)) ** 2 + (de / 0.55) ** 2)) + np.exp(
                -0.5 * ((de / (9 * flare)) ** 2 + (dl / 0.55) ** 2))
            w = w + 0.35 * spike
        idx = (iy * W + ix).reshape(-1)
        for k in range(3):
            flat[:, k] += np.bincount(idx, weights=(w * rgb[sel, k][:, None]).reshape(-1), minlength=H * W).astype(F)


def star_field(rng, n, max_peak=1.0, min_peak=0.02, slope=1.2):
    """Pareto brightness like real star counts: N(>b) ~ b^-slope."""
    dirs = random_dirs(rng, n)
    peak = np.minimum(min_peak * rng.random(n) ** (-1.0 / slope), max_peak)
    temp = rng.random(n)
    tint = ramp(temp, [(0.0, C(255, 190, 150)), (0.35, C(255, 240, 225)), (0.7, C(235, 240, 255)), (1.0, C(190, 210, 255))])
    return dirs, tint * peak[:, None].astype(F), peak


# ─── skies ───────────────────────────────────────────────────────────────────
# Each shade(d, lon, el, px) returns linear display RGB for a chunk of pixels.
# px = angular size of one pixel (radians), used for analytic anti-aliasing.

class Sky:
    id = ""
    name = ""
    blurb = ""
    sun = None          # (lon, el) degrees of the main light, or None
    sun_color = (255, 240, 220)
    sun_irradiance = 0.0  # light the sun adds to the env map (normal incidence)
    env_mean = 1.0        # mean upper-sky radiance of the env map (bundled HDRIs: ~1.0-1.4)
    sun_sigma_deg = 0.8

    def __init__(self):
        self.p = Perlin(zlib.crc32(self.id.encode()))

    def prepare(self, W, H):
        pass

    def shade(self, d, lon, el, px):
        raise NotImplementedError

    def post(self, img):
        pass


def sun_disk(d, sdir, radius, px, squash=1.0):
    """Anti-aliased disk mask and normalised radius (0 centre, 1 edge)."""
    if squash != 1.0:
        e, n = tangent_frame(sdir)
        de = d @ e
        dn = (d @ n) / squash
        dc = d @ sdir
        ang = np.arctan2(np.sqrt(de * de + dn * dn), dc)
    else:
        ang = np.arccos(np.clip(d @ sdir, -1, 1))
    mask = smoothstep(radius + px, radius - px, ang)
    return mask.astype(F), (ang / radius).astype(F)


def layer_silhouette(lon, el, height, px, soft=1.0):
    """Coverage of terrain whose top edge sits at elevation height(lon)."""
    return smoothstep(height + px * soft, height - px * soft, el).astype(F)


class DuneField:
    """Transverse sand dunes as a heightfield (metres), ray-marched from a
    viewer standing in a flat basin (the oasis): gentle windward slopes,
    steep slip faces, soft long shadows from a low sun."""

    def __init__(self, per, sun_lon, extent=10000.0, n=4096, eye=4.0):
        self.ext, self.n, self.eye = extent, n, eye
        self.cell = 2 * extent / n
        c = (np.arange(n) + 0.5) * self.cell - extent
        sx, sz = math.cos(sun_lon), math.sin(sun_lon)
        wa = sun_lon + math.radians(68.0)  # wind direction (slip faces face downwind)
        wx, wz = math.cos(wa), math.sin(wa)
        Hm = np.empty((n, n), F)
        for r0 in range(0, n, 128):
            zz, xx = np.meshgrid(c[r0:r0 + 128], c, indexing="ij")
            u = xx * wx + zz * wz
            v = -xx * wz + zz * wx
            warp = 150.0 * per.fbm2(u / 1300.0 + 3, v / 1300.0 - 5, 3) + 40.0 * per.fbm2(u / 350.0, v / 350.0 + 9, 2)
            lam = 520.0 * (1.0 + 0.25 * per.fbm2(u / 4000.0 - 2, v / 4000.0, 2))
            f = ((u + warp) / lam) % 1.0
            rise = 0.8
            wind = np.sin(np.clip(f / rise, 0, 1) * math.pi / 2) ** 1.35  # windward slope up to the crest
            slip = (1.0 - np.clip((f - rise) / (1 - rise), 0, 1)) ** 1.7    # steep lee face
            prof = np.where(f < rise, wind, slip)
            amp = 48.0 + 22.0 * per.fbm2(u / 1800.0 + 11, v / 900.0, 3)
            amp *= 0.75 + 0.25 * np.sin(v / 520.0 + 0.004 * warp)  # crests rise and fall along their length
            r = np.hypot(xx, zz)
            cosphi = (xx * sx + zz * sz) / np.maximum(r, 1e-6)
            amp *= 1.0 - 0.72 * smoothstep(0.72, 0.97, cosphi)  # keep the low sun clear
            amp *= smoothstep(150.0, 340.0, r)  # flat oasis basin around the viewer
            und = 14.0 * per.fbm2(xx / 2600.0 - 4, zz / 2600.0 + 6, 2) * smoothstep(150.0, 900.0, r)
            Hm[r0:r0 + 128] = np.maximum(amp * prof + und, 0.0)
        self.H = Hm
        self.hmax = float(Hm.max())

    def sample(self, x, z):
        fx = (x + self.ext) / self.cell - 0.5
        fz = (z + self.ext) / self.cell - 0.5
        ix, iz = np.floor(fx).astype(np.int64), np.floor(fz).astype(np.int64)
        ok = (ix >= 0) & (iz >= 0) & (ix < self.n - 1) & (iz < self.n - 1)
        ix, iz = np.clip(ix, 0, self.n - 2), np.clip(iz, 0, self.n - 2)
        tx, tz = (fx - ix).astype(F), (fz - iz).astype(F)
        t = self.H
        a, b = t[iz, ix], t[iz, ix + 1]
        c, d = t[iz + 1, ix], t[iz + 1, ix + 1]
        top = a + (b - a) * tx
        v = top + ((c + (d - c) * tx) - top) * tz
        return np.where(ok, v, F(0))

    def trace(self, d, px, sdir, sun_col, amb_up, amb_side, albedo):
        """Returns coverage (N,), linear colour (N,3), distance (N,) in metres."""
        N = len(d)
        y = d[:, 1]
        t = np.full(N, 1.0)
        best = np.full(N, 1e9)   # closest approach in pixels (for anti-aliased crests)
        best_t = np.full(N, np.nan)
        hit = np.zeros(N, bool)
        tmax = 1.2 * self.ext
        active = np.arange(N)
        for _ in range(320):
            if not active.size:
                break
            a = active
            ta = t[a]
            hx, hz = d[a, 0] * ta, d[a, 2] * ta
            hr = self.eye + y[a] * ta
            dh = hr - self.sample(hx, hz)
            ratio = dh / (ta * px)
            closer = ratio < best[a]
            best[a[closer]] = ratio[closer]
            best_t[a[closer]] = ta[closer]
            h_now = dh < 0.0015 * ta
            hit[a[h_now]] = True
            t[a] = ta + np.maximum(np.maximum(0.5, 0.0025 * ta), 0.9 * dh)
            done = h_now | (t[a] > tmax) | ((y[a] > 0) & (hr > self.hmax + 2))
            active = a[~done]
        cov = np.where(hit, 1.0, np.clip(1.0 - best, 0.0, 1.0))
        use = cov > 0
        col = np.zeros((N, 3), F)
        dist = np.full(N, tmax)
        if not use.any():
            return cov.astype(F), col, dist
        idx = np.where(use)[0]
        th = np.where(hit[idx], t[idx], best_t[idx])
        # pull hits back onto the surface
        lo = np.maximum(th - np.maximum(0.5, 0.05 * th), 1.0)
        hi = th.copy()
        dd, yy = d[idx], y[idx]
        hidx = hit[idx]
        for _ in range(5):
            mid = (lo + hi) * 0.5
            inside = (self.eye + yy * mid) < self.sample(dd[:, 0] * mid, dd[:, 2] * mid)
            hi = np.where(hidx & inside, mid, hi)
            lo = np.where(hidx & ~inside, mid, lo)
        th = np.where(hidx, hi, th)
        x, z = dd[:, 0] * th, dd[:, 2] * th
        Hs = self.sample(x, z)
        e = self.cell
        gx = (self.sample(x + e, z) - self.sample(x - e, z)) / (2 * e)
        gz = (self.sample(x, z + e) - self.sample(x, z - e)) / (2 * e)
        nrm = np.stack([-gx, np.ones_like(gx), -gz], 1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        # soft shadow toward the low sun
        sh = np.ones(len(idx))
        tt = np.full(len(idx), 3.0)
        for _ in range(28):
            hx, hz = x + sdir[0] * tt, z + sdir[2] * tt
            hh = Hs + 0.5 + sdir[1] * tt
            sh = np.minimum(sh, 9.0 * (hh - self.sample(hx, hz)) / tt)
            tt = tt + np.maximum(4.0, 0.12 * tt)
        sh = np.clip(sh, 0, 1) ** 1.5
        ndl = np.clip(nrm @ sdir, 0, None)
        sun = (ndl * sh)[:, None] * sun_col[None]
        amb = amb_up[None] * (0.55 + 0.45 * nrm[:, 1:2]) + amb_side[None] * 0.35
        c = albedo[None] * (sun + amb)
        col[idx] = c.astype(F)
        dist[idx] = th * np.sqrt(np.maximum(1 - yy * yy, 0))
        return cov.astype(F), col, dist


class OasisDusk(Sky):
    id = "oasis_dusk"
    name = "Oasis Dusk (generated)"
    blurb = "Warm desert sunset: low golden sun over dune silhouettes, pink high clouds, first evening star."
    sun = (-138.0, 3.2)
    sun_color = (255, 170, 95)
    sun_irradiance = 1.6
    env_mean = 0.75

    def prepare(self, W, H):
        self.dunes = DuneField(self.p, math.radians(self.sun[0]))

    def shade(self, d, lon, el, px):
        sdir = direction(*self.sun)
        sun_lon = math.radians(self.sun[0])
        y = d[:, 1]
        eld = np.degrees(el)
        cosg = d @ sdir
        gam = np.arccos(np.clip(cosg, -1, 1))
        # how much this azimuth faces the sun (1) or away from it (0)
        az = (np.cos(lon - sun_lon) + 1.0) * 0.5
        sun_side = ramp(eld, [(-2, C(255, 176, 92)), (0.0, C(255, 190, 102)), (2.5, C(255, 158, 74)),
                              (6, C(247, 118, 62)), (11, C(222, 88, 74)), (19, C(160, 70, 104)),
                              (32, C(86, 52, 110)), (55, C(36, 34, 82)), (90, C(17, 20, 56))])
        anti = ramp(eld, [(-2, C(66, 62, 96)), (0.0, C(84, 76, 112)), (2.5, C(96, 82, 122)),
                          (5.5, C(170, 112, 140)), (9, C(196, 128, 146)), (15, C(150, 106, 146)),
                          (28, C(78, 64, 120)), (55, C(34, 32, 82)), (90, C(17, 20, 56))])
        sky = mix(anti, sun_side, az ** 1.6)
        h0 = np.full_like(eld, 0.6)
        sun_side_h = ramp(h0, [(0.0, C(255, 190, 102)), (2.5, C(255, 158, 74))])
        anti_h = ramp(h0, [(0.0, C(84, 76, 112)), (2.5, C(96, 82, 122))])
        sun_side_h = sun_side_h + (C(255, 150, 70) * (0.55 * np.exp(-gam / 0.35) + 0.25 * np.exp(-gam / 0.9))[:, None]).astype(F)
        # glow around the low sun, flattened along the horizon
        hor = np.exp(-np.maximum(eld, 0) / 9.0)
        glow = (0.95 * np.exp(-gam / 0.10) + 0.55 * np.exp(-gam / 0.35) * hor + 0.25 * np.exp(-gam / 0.9) * hor)
        sky += (C(255, 150, 70) * glow[:, None]).astype(F)

        # high cirrus streaks radiating from the sun's vanishing point
        up = y > 0.004
        cl = np.zeros_like(y)
        cc = np.zeros((len(y), 3), F)
        if up.any():
            dy = y[up]
            t = 9.0 / dy
            px_, pz_ = d[up, 0] * t, d[up, 2] * t
            sx, sz = math.cos(sun_lon), math.sin(sun_lon)
            along = px_ * sx + pz_ * sz
            across = -px_ * sz + pz_ * sx
            foot = 9.0 * px / (dy * dy)
            n = self.p.fbm2(along * 0.018, across * 0.085, octaves=6, footprint=foot * 0.085)
            patch = self.p.fbm2(along * 0.006 + 40, across * 0.012 - 20, octaves=3)
            dens = smoothstep(-0.05, 0.55, n + 0.65 * patch - 0.05)
            dens *= smoothstep(0.012, 0.09, dy)  # thin out into the horizon haze
            cl[up] = dens * 0.85
            g = gam[up]
            lit = ramp(np.degrees(g), [(0, C(255, 214, 140)), (12, C(255, 160, 96)), (35, C(246, 110, 112)),
                                       (70, C(196, 92, 128)), (110, C(140, 82, 132)), (180, C(98, 74, 124))])
            core = smoothstep(0.35, 0.9, n + 0.5 * patch)
            near = np.exp(-g / 0.5)
            shade_ = 1.0 - 0.55 * core * near  # thick cloud near the sun goes dark
            alt = np.clip(eld[up] / 60.0, 0, 1)
            cc[up] = lit * (shade_ * (1.0 - 0.45 * alt))[:, None]
        sky = over(sky, cc, cl)

        # the sun itself, a little flattened by refraction
        disk, rr = sun_disk(d, sdir, math.radians(0.95), px, squash=0.9)
        scol = ramp(rr, [(0, C(255, 246, 214)), (0.6, C(255, 222, 160)), (1.0, C(255, 168, 92))]) * 1.25
        sky = over(sky, scol, disk)

        # dunes: a ray-marched dune field around a flat oasis basin
        out = sky
        hz_az = mix(anti_h, sun_side_h, az ** 1.6)  # horizon haze colour per azimuth
        m = eld < 12.0
        if m.any():
            cov, col, dist = self.dunes.trace(
                d[m], px, sdir,
                sun_col=np.array([2.9, 1.95, 1.25], F),
                amb_up=np.array([0.17, 0.15, 0.36], F),
                amb_side=np.array([0.16, 0.08, 0.07], F),
                albedo=np.array([0.55, 0.36, 0.22], F))
            fog = (1.0 - np.exp(-dist / 3000.0)) * (0.82 + 0.18 * az[m])
            col = mix(col, hz_az[m], fog)
            out[m] = over(out[m], col, cov)
        return out

    def post(self, img):
        H, W, _ = img.shape
        rng = np.random.default_rng(31)
        # a few faint stars high on the side away from the sun
        dirs, rgb, peak = star_field(rng, 1400, max_peak=0.4, min_peak=0.012)
        sdir = direction(*self.sun)
        keep = (dirs[:, 1] > 0.35) & (dirs @ sdir < 0.2)
        fade = np.clip((dirs[keep, 1] - 0.35) / 0.5, 0, 1) * np.clip((0.2 - dirs[keep] @ sdir) / 0.6, 0, 1)
        splat(img, dirs[keep], rgb[keep] * fade[:, None].astype(F), 0.55)
        venus = direction(self.sun[0] + 17.0, 15.5)[None]
        splat(img, venus, C(255, 246, 225)[None] * 1.6, 0.85)


class AuroraNight(Sky):
    id = "aurora_night"
    name = "Aurora Night (generated)"
    blurb = "Deep blue arctic night: green and violet aurora curtains, dense star field, faint Milky Way, pine treeline."
    sun = None
    env_mean = 0.07

    def prepare(self, W, H):
        # aurora curtains as polylines in the horizontal plane (km), solved
        # per azimuth column so vertical rays stay crisp at any resolution
        rng = np.random.default_rng(5)
        self.curtains = []
        specs = [
            # x range, base distance (z, toward north), wobble, brightness
            dict(x0=-1500, x1=1500, z=300, wob=120, fold=0.0, bright=1.0, seed=1),
            dict(x0=-700, x1=800, z=105, wob=45, fold=40.0, bright=0.8, seed=2),
            dict(x0=-900, x1=600, z=620, wob=80, fold=0.0, bright=0.6, seed=3),
        ]
        north = math.radians(-60.0)  # the aurora hangs over this azimuth
        for s in specs:
            t = np.linspace(s["x0"], s["x1"], 6000)
            pr = Perlin(100 + s["seed"])
            z = s["z"] + s["wob"] * pr.fbm2(t * 0.0022, np.full_like(t, 3.0), 4)
            x = t.copy()
            if s["fold"]:
                # a slow S-fold, the kind that rolls across the sky
                x = x + s["fold"] * np.sin(t * 0.0065) * 1.6
                z = z + s["fold"] * np.cos(t * 0.0065)
            # rotate so the curtain arcs across the chosen azimuth
            ca, sa = math.cos(north), math.sin(north)
            X = z * ca - x * sa
            Z = z * sa + x * ca
            self.curtains.append(dict(X=X, Z=Z, s=t, bright=s["bright"], per=pr, s0=s["x0"], s1=s["x1"]))
        self.columns = None

    def _crossings(self, lons):
        """For each column azimuth, where its ray meets each curtain."""
        res = []
        for c in self.curtains:
            X, Z = c["X"], c["Z"]
            ang = np.arctan2(Z, X)
            r = np.hypot(X, Z)
            a0, a1 = ang[:-1], ang[1:]
            da = np.angle(np.exp(1j * (a1 - a0)))
            hits = []
            for lo in lons:
                rel0 = np.angle(np.exp(1j * (lo - a0)))
                f = rel0 / np.where(np.abs(da) < 1e-12, 1e-12, da)
                ok = np.where((f >= 0) & (f < 1) & (np.abs(rel0) < 0.5))[0]
                h = []
                for i in ok:
                    fi = f[i]
                    rr = r[i] + (r[i + 1] - r[i]) * fi
                    tx, tz = X[i + 1] - X[i], Z[i + 1] - Z[i]
                    tl = math.hypot(tx, tz) or 1.0
                    hx, hz = math.cos(lo), math.sin(lo)
                    sinang = abs(hx * tz - hz * tx) / tl  # ray vs sheet angle
                    h.append((rr, c["s"][i] + (c["s"][i + 1] - c["s"][i]) * fi, sinang))
                hits.append(h)
            res.append(hits)
        return res

    def shade(self, d, lon, el, px):
        y = d[:, 1]
        eld = np.degrees(el)
        sky = ramp(eld, [(-90, C(10, 14, 20)), (-3, C(16, 22, 30)), (0, C(30, 52, 74)), (2, C(26, 46, 70)),
                         (8, C(18, 34, 60)), (20, C(12, 24, 50)), (45, C(8, 16, 38)), (90, C(6, 11, 30))])
        # airglow band
        sky += (C(30, 60, 50) * (0.35 * np.exp(-((eld - 9.0) / 6.0) ** 2))[:, None]).astype(F)
        # milky way: noisy band around a tilted great circle
        nrm = np.array([0.42, 0.62, -0.66])
        nrm /= np.linalg.norm(nrm)
        b = d @ nrm
        band = np.exp(-(b / 0.17) ** 2)
        band = np.exp(-(b / 0.12) ** 2)
        dust = self.p.fbm3(d[:, 0] * 9, d[:, 1] * 9, d[:, 2] * 9, 5)
        clumps = self.p.fbm3(d[:, 0] * 30 + 3, d[:, 1] * 30, d[:, 2] * 30, 4)
        lane = smoothstep(0.0, 0.35, dust + 0.8 * (0.06 - np.abs(b)))
        mw = band * np.clip(0.5 + 0.8 * clumps, 0, 1.3) * (1 - 0.8 * lane) * smoothstep(-2, 25, eld)
        sky += (C(150, 160, 190) * (0.16 * np.clip(mw, 0, None))[:, None]).astype(F)

        # aurora
        aur = np.zeros((len(y), 3), F)
        upm = y > 0.02
        if upm.any():
            W = self.W
            col = np.round(((lon / TAU) + 0.5) * W - 0.5).astype(int) % W
            tan_el = np.tan(el)
            for ci, c in enumerate(self.curtains):
                for k in range(self.max_hits):
                    r = self.col_r[ci][k][col]
                    valid = upm & (r > 0)
                    if not valid.any():
                        continue
                    s = self.col_s[ci][k][col]
                    sinang = self.col_sin[ci][k][col]
                    hgt = r * tan_el
                    pr = c["per"]
                    base = 98.0 + 9.0 * pr.n2(s * 0.004, np.full_like(s, 1.7))
                    rel = hgt - base
                    green = smoothstep(-1.5, 1.0, rel) * np.exp(-np.maximum(rel, 0) / 22.0)
                    red = smoothstep(-2, 30, rel) * np.exp(-((rel - 70.0) / 55.0) ** 2) * 0.42
                    fringe = np.exp(-((rel + 0.3) / 1.1) ** 2) * 0.35
                    rays = 0.45 + 0.55 * np.clip(0.5 + 0.9 * pr.fbm2(s * 0.09, np.full_like(s, 7.0), 3), 0, 1)
                    envl = np.clip(0.55 + 0.9 * pr.fbm2(s * 0.003, np.full_like(s, 11.0), 3), 0.05, 1.3)
                    path = 1.0 / np.maximum(sinang * np.cos(el), 0.11)
                    path = np.minimum(path, 9.0) * 0.16
                    taper = smoothstep(c["s0"], c["s0"] + 350, s) * smoothstep(c["s1"], c["s1"] - 350, s)
                    amt = (c["bright"] * rays * envl * path * taper)[:, None]
                    emis = (C(70, 255, 150) * green[:, None] + C(190, 60, 170) * red[:, None]
                            + C(255, 90, 170) * fringe[:, None]) * amt
                    aur += np.where(valid[:, None], emis, 0).astype(F)
        self._aur_chunk = aur
        sky = sky + aur * 1.5

        # treeline: spiky conifers on a low ridge
        hill = 0.25 + 0.9 * circle_noise(self.p, lon, 2.5, 3) + 0.4
        spikes = self._trees(lon)
        h = hill + spikes
        cov = layer_silhouette(lon, eld, h, np.degrees(px), soft=1.0)
        land = ramp(-eld, [(-3, C(5, 8, 11)), (0, C(6, 9, 12)), (3, C(12, 17, 23)), (12, C(16, 22, 30)),
                           (90, C(12, 16, 22))])
        # snow below the trees catches a little aurora light
        snow = smoothstep(0.0, -2.5, eld - (hill - 0.6))
        land = land + (C(30, 70, 60) * (0.22 * snow * smoothstep(-25, -1, eld))[:, None]).astype(F)
        return over(sky, land, cov)

    def _trees(self, lon):
        W = 4096 * 4
        if not hasattr(self, "_tree_prof"):
            rng = np.random.default_rng(77)
            grid = np.zeros(W, np.float64)
            x = np.arange(W)
            n = 2600
            centers = rng.uniform(0, W, n)
            heights = rng.gamma(4.0, 0.22, n) * (0.6 + 0.8 * rng.random(n))
            widths = heights * rng.uniform(5.5, 8.0, n)  # in samples per degree-ish
            for cx_, hh, ww in zip(centers, heights, widths):
                lo, hi = int(cx_ - ww), int(cx_ + ww) + 1
                idx = np.arange(lo, hi)
                prof = hh * np.clip(1 - np.abs(idx - cx_) / ww, 0, 1) ** 1.4
                # little branch tiers
                prof *= 1 - 0.12 * (np.sin((idx - cx_) * 0) + 0)
                grid[idx % W] = np.maximum(grid[idx % W], prof)
            # sparse gaps in the forest
            gaps = smoothstep(-0.35, 0.05, Perlin(9).fbm2(np.cos(x / W * TAU) * 3, np.sin(x / W * TAU) * 3, 3))
            self._tree_prof = grid * gaps
        u = ((lon / TAU) + 0.5) * W
        return np.interp(u, np.arange(W + 1), np.append(self._tree_prof, self._tree_prof[0])).astype(F)

    def post(self, img):
        H, W, _ = img.shape
        add = np.zeros_like(img)
        rng = np.random.default_rng(12)
        dirs, rgb, peak = star_field(rng, 11000, max_peak=1.4, min_peak=0.014)
        alt = np.clip((dirs[:, 1] - 0.01) / 0.12, 0, 1)
        dim = (alt * (1 - 0.6 * np.exp(-dirs[:, 1] / 0.08)))[:, None].astype(F)
        # milky way gets extra faint stars
        nrm = np.array([0.42, 0.62, -0.66])
        nrm /= np.linalg.norm(nrm)
        d2 = random_dirs(rng, 9000)
        keep = np.abs(d2 @ nrm) < rng.random(9000) * 0.2
        d2 = d2[keep]
        rgb2 = np.full((len(d2), 3), 0.03, F) * rng.random((len(d2), 1)).astype(F)
        alt2 = np.clip((d2[:, 1] - 0.01) / 0.12, 0, 1)[:, None].astype(F)
        splat(add, dirs, rgb * dim, 0.55)
        splat(add, d2, rgb2 * alt2, 0.5)
        bright = peak > 0.5
        splat(add, dirs[bright], rgb[bright] * dim[bright] * 0.06, 2.2)  # soft halos
        # aurora glow scattered in the air
        glow = self._aur_full
        small = glow[::4, ::4]
        small = ndimage.gaussian_filter(small, sigma=(6, 6, 0), mode=("nearest", "wrap", "nearest"))
        big = np.repeat(np.repeat(small, 4, 0), 4, 1)[:H, :W]
        add += (big * 1.1).astype(F)
        img += add * self._sky_mask  # nothing shines through the trees


class PastelDawn(Sky):
    id = "pastel_dawn"
    name = "Pastel Dawn (generated)"
    blurb = "Soft pink and lavender dawn: low hazy sun, layered misty hills, thin glowing cloud wisps."
    sun = (-128.0, 4.0)
    sun_color = (255, 222, 196)
    sun_irradiance = 1.6
    env_mean = 1.0

    def shade(self, d, lon, el, px):
        sdir = direction(*self.sun)
        sun_lon = math.radians(self.sun[0])
        y = d[:, 1]
        eld = np.degrees(el)
        gam = np.arccos(np.clip(d @ sdir, -1, 1))
        az = (np.cos(lon - sun_lon) + 1.0) * 0.5
        sun_side = ramp(eld, [(-3, C(252, 220, 204)), (0, C(255, 230, 208)), (3, C(255, 214, 192)), (8, C(252, 196, 192)),
                              (16, C(238, 184, 200)), (28, C(210, 176, 214)), (48, C(176, 170, 226)), (90, C(140, 156, 222))])
        anti = ramp(eld, [(-3, C(196, 184, 214)), (0, C(204, 190, 218)), (2.5, C(214, 186, 212)), (6, C(232, 186, 204)),
                          (12, C(222, 182, 210)), (24, C(196, 176, 220)), (48, C(166, 166, 224)), (90, C(140, 156, 222))])
        sky = mix(anti, sun_side, az ** 1.3)
        hor = np.exp(-np.maximum(eld, 0) / 12.0)
        glow = 0.55 * np.exp(-gam / 0.09) + 0.35 * np.exp(-gam / 0.32) * hor + 0.18 * np.exp(-gam / 0.9)
        sky += (C(255, 220, 180) * glow[:, None]).astype(F)
        # haze strata just above the horizon
        strat = self.p.fbm2(np.cos(lon) * 3.0, np.sin(lon) * 3.0 + eld * 0.0, 3)
        for e0, w, a in [(1.2, 0.5, 0.20), (3.0, 0.8, 0.14), (5.5, 1.1, 0.08)]:
            band = np.exp(-((eld - e0 - 0.6 * strat) / w) ** 2) * a * (0.6 + 0.4 * strat)
            sky = mix(sky, mix(anti, sun_side, az)[:, :] * 1.08, np.clip(band, 0, 1))
        # wispy altostratus lit pink and gold
        upm = y > 0.004
        if upm.any():
            dy = y[upm]
            t = 4.0 / dy
            px_, pz_ = d[upm, 0] * t, d[upm, 2] * t
            foot = 4.0 * px / (dy * dy)
            n = self.p.fbm2(px_ * 0.05 + 5, pz_ * 0.16, 6, footprint=foot * 0.16)
            m = self.p.fbm2(px_ * 0.012, pz_ * 0.02 + 9, 3)
            a = smoothstep(0.05, 0.6, n + 0.6 * m - 0.15) * 0.55 * smoothstep(0.015, 0.12, dy)
            g = np.degrees(gam[upm])
            lit = ramp(g, [(0, C(255, 236, 214)), (15, C(255, 206, 190)), (45, C(246, 184, 206)),
                           (90, C(220, 178, 216)), (180, C(200, 176, 222))])
            sub = sky[upm]
            sky[upm] = over(sub, lit * 1.04, a)
        # misty hills: each layer fades into the haze at its foot
        out = sky
        hazec = mix(anti, sun_side, az ** 1.3)
        # (base deg, amplitude deg, noise radius, seed, colour, haze at the crest)
        layers = [(0.6, 3.4, 1.6, 2.0, C(206, 178, 212), 0.62),
                  (-0.6, 4.2, 2.1, 5.0, C(178, 146, 192), 0.42),
                  (-2.6, 4.8, 2.7, 9.0, C(146, 116, 166), 0.24),
                  (-5.4, 5.2, 3.4, 15.0, C(116, 92, 140), 0.10)]
        for base, amp, rad, seed, col, hz in layers:
            n = circle_noise(self.p, lon, rad, 5, seed_off=seed) * 1.7
            h = base + amp * np.clip(0.5 + 0.5 * n, 0.0, 1.2)
            cov = layer_silhouette(lon, eld, h, np.degrees(px), soft=1.2)
            # crest catches the dawn light; valleys hold flat banks of mist
            rim = np.exp(-np.maximum(h - eld, 0) / 0.35) * (0.25 + 0.75 * az ** 3)
            c = col * (0.92 + 0.14 * az[:, None]).astype(F) + (C(255, 214, 196) * (0.18 * rim)[:, None]).astype(F)
            fog_top = base + amp * 0.42
            fog = smoothstep(fog_top + 0.6, fog_top - 1.4, eld) * 0.85
            c = mix(c, hazec * 1.03, F(hz) + (1 - F(hz)) * fog)
            out = over(out, c, cov)
        floor = ramp(-eld, [(4, C(170, 154, 192)), (12, C(150, 134, 174)), (30, C(126, 112, 152)), (90, C(104, 94, 132))])
        out = over(out, floor, smoothstep(-6.0, -10.0, eld).astype(F))
        return out


class CyberDusk(Sky):
    id = "cyber_dusk"
    name = "Cyber Dusk (generated)"
    blurb = "Synthwave dusk: violet sky burning to orange at the horizon, giant striped moon, neon-rimmed mountains, glowing grid floor."
    sun = (-124.0, 17.0)  # the moon
    sun_color = (255, 170, 230)
    sun_irradiance = 0.35
    env_mean = 0.45
    moon_radius = 10.5

    def shade(self, d, lon, el, px):
        mdir = direction(*self.sun)
        m_lon = math.radians(self.sun[0])
        y = d[:, 1]
        eld = np.degrees(el)
        az = (np.cos(lon - m_lon) + 1.0) * 0.5
        sky = ramp(eld, [(-1, C(255, 196, 96)), (0, C(255, 190, 92)), (1.2, C(255, 140, 74)), (3.5, C(255, 84, 112)),
                         (8, C(214, 40, 140)), (16, C(130, 26, 132)), (28, C(66, 18, 104)), (50, C(26, 9, 62)),
                         (90, C(9, 4, 28))])
        sky = sky * (0.78 + 0.22 * az[:, None] ** 2).astype(F)
        gam = np.arccos(np.clip(d @ mdir, -1, 1))
        R = math.radians(self.moon_radius)
        halo = 0.55 * np.exp(-np.maximum(gam - R, 0) / 0.05) + 0.3 * np.exp(-np.maximum(gam - R, 0) / 0.22)
        sky += (C(255, 70, 190) * halo[:, None]).astype(F)
        # the moon
        e, n = tangent_frame(mdir)
        de, dn = (d @ e) / math.sin(R), (d @ n) / math.sin(R)
        disk, rr = sun_disk(d, mdir, R, px)
        if disk.any():
            maria = self.p.fbm2(de * 1.6 + 4, dn * 1.6 - 3, 4)
            crater = self.p.fbm2(de * 7, dn * 7, 3)
            tone = np.clip(0.97 - 0.13 * smoothstep(0.1, 0.55, maria) + 0.03 * crater, 0, 1)
            grad = np.clip((dn + 1) / 2, 0, 1)
            mc = ramp(grad, [(0, C(255, 70, 150)), (0.4, C(255, 150, 196)), (0.75, C(255, 214, 236)), (1, C(255, 244, 252))])
            mcol = mc * tone[:, None].astype(F) * 1.08
            # synthwave slices through the lower half, thicker toward the bottom
            v = -dn
            k = 7.0
            fr = (v * k + 0.35) % 1.0
            gap = np.clip((v - 0.02) * 0.62, 0, 0.6)
            aa = (math.degrees(px) / self.moon_radius) * k * 1.5
            slit = np.where(v > 0.05, 1.0 - smoothstep(-aa, aa, gap - fr), 1.0)
            disk = disk * slit.astype(F)
            sky = over(sky, mcol, disk)
        # horizon haze glow
        sky += (C(255, 110, 140) * (0.32 * np.exp(-np.abs(eld) / 1.6))[:, None]).astype(F)

        out = sky
        # ground: dark violet floor with a neon grid
        gm = y < 0
        if gm.any():
            dy = -y[gm]
            t = 1.0 / np.maximum(dy, 1e-4)
            gx, gz = d[gm, 0] * t, d[gm, 2] * t
            foot = px * t / np.maximum(dy, 1e-3)  # grid-units per pixel
            def lines(c, f):
                w = 0.035
                fw = np.maximum(f, 1e-6)
                # box-filtered line pulse
                a = c / 1.0
                fa = np.abs(((a + 0.5) % 1.0) - 0.5)
                cov = np.clip((w * 0.5 + fw * 0.5 - fa) / fw, 0, 1) * np.minimum(w / fw, 1.0)
                return cov
            gl = np.maximum(lines(gx * 0.5, foot * 0.5), lines(gz * 0.5, foot * 0.5))
            fade = np.exp(-np.maximum(foot - 0.15, 0) * 2.5)
            dist_fade = smoothstep(0.0, 0.08, dy) * (1.0 - smoothstep(0.25, 0.6, dy))
            floor = ramp(np.degrees(np.arcsin(dy)), [(0, C(70, 18, 70)), (2, C(36, 8, 50)), (10, C(18, 4, 34)), (90, C(10, 2, 22))])
            neon = C(255, 50, 210) * 1.35
            fc = floor + (neon * (gl * fade * (0.45 + 0.55 * dist_fade))[:, None]).astype(F)
            fc += (C(255, 120, 120) * (0.35 * np.exp(-np.degrees(np.arcsin(dy)) / 1.2))[:, None]).astype(F)
            out[gm] = fc
        # mountains: far range in haze, near range dark with a neon rim
        for base, amp, rad, seed, col, rimc, hz in [
            (0.0, 4.6, 2.0, 3.0, C(92, 28, 108), C(255, 120, 220), 0.55),
            (-0.05, 3.2, 3.0, 8.0, C(26, 6, 44), C(80, 230, 255), 0.0),
        ]:
            ridge = circle_noise(self.p, lon, rad, 5, ridged=True, seed_off=seed)
            h = base + amp * np.clip(ridge - 1.0, 0, None) * 1.4
            # mountains stand on the horizon; the grid floor stays visible below
            cov = layer_silhouette(lon, eld, h, np.degrees(px), soft=1.0) * smoothstep(-0.25 - np.degrees(px), -0.25 + np.degrees(px), eld).astype(F)
            depth = np.clip(h - eld, 0, None)
            rim = np.exp(-depth / (np.degrees(px) * 1.6)) * (h > base + 0.15)
            c = mix(col, sky, F(hz) * np.exp(-depth / 3.0))
            c = c + (rimc * (rim * 1.1)[:, None]).astype(F)
            # faint wireframe contour lines on the near range
            if hz == 0.0:
                cont = np.abs(((depth * 1.4) % 1.0) - 0.5) < 0.03 + np.degrees(px) * 0.7
                c = c + (C(120, 40, 200) * (0.25 * cont * np.exp(-depth / 2.5))[:, None]).astype(F)
            out = over(out, c, cov)
        return out

    def post(self, img):
        rng = np.random.default_rng(44)
        dirs, rgb, peak = star_field(rng, 2600, max_peak=1.0, min_peak=0.03)
        alt = smoothstep(0.12, 0.45, dirs[:, 1])[:, None].astype(F)
        mdir = direction(*self.sun)
        away = (np.arccos(np.clip(dirs @ mdir, -1, 1)) > math.radians(self.moon_radius + 3))[:, None]
        splat(img, dirs, rgb * alt * away, 0.6)
        big = (peak > 0.7) & (dirs[:, 1] > 0.3) & (dirs[:, 1] < 0.85) & away[:, 0]
        splat(img, dirs[big], rgb[big] * 0.5, 0.9, flare=1.0)


class CumulusField:
    """Fair-weather cumulus, ray-marched as a volume. A 2D coverage map says
    where clouds are and how tall they grow (domes on a flat base). Density is
    soft at the edges; light is Beer-Lambert toward the sun with a
    forward-scattering phase, so bases come out grey, sunlit sides bright and
    edges toward the sun glow. Distances in km, viewer at the origin."""

    def __init__(self, per, extent=90.0, n=3072, base=1.3, tmax=1.05):
        self.ext, self.n, self.base, self.tmax = extent, n, base, tmax
        self.cell = 2 * extent / n
        self.per = per
        c = (np.arange(n) + 0.5) * self.cell - extent
        cov = np.empty((n, n), F)
        for r0 in range(0, n, 128):
            zz, xx = np.meshgrid(c[r0:r0 + 128], c, indexing="ij")
            puffs = per.fbm2(xx * 0.55 + 3.3, zz * 0.55 - 1.7, 6)
            billow = 1.0 - np.abs(per.fbm2(xx * 1.9 + 9, zz * 1.9 - 4, 4))
            patches = per.fbm2(xx * 0.06 + 31, zz * 0.06 - 7, 3)
            v = puffs + 0.22 * billow + 0.55 * patches - 0.42
            cov[r0:r0 + 128] = np.clip(v / 0.45, 0, 1)
        # dome height from blurred coverage: broad rounded tops, lumpy like cauliflower
        cs = ndimage.gaussian_filter(cov, 5.0)
        lump = np.empty((n, n), F)
        for r0 in range(0, n, 128):
            zz, xx = np.meshgrid(c[r0:r0 + 128], c, indexing="ij")
            lump[r0:r0 + 128] = 1.0 - np.abs(per.fbm2(xx * 3.2 - 7, zz * 3.2 + 2, 3))
        top = tmax * np.clip((cs - 0.06) / 0.7, 0, 1) ** 0.55 * (0.62 + 0.5 * lump)
        sharp = np.stack([cov, top.astype(F)], -1)
        far = np.stack([ndimage.gaussian_filter(cov, 4.0), ndimage.gaussian_filter(top, 4.0)], -1).astype(F)
        self.tex = [sharp, far]

    def sample(self, x, z, lvl):
        fx = (x + self.ext) / self.cell - 0.5
        fz = (z + self.ext) / self.cell - 0.5
        ix, iz = np.floor(fx).astype(np.int64), np.floor(fz).astype(np.int64)
        ok = (ix >= 0) & (iz >= 0) & (ix < self.n - 1) & (iz < self.n - 1)
        ix, iz = np.clip(ix, 0, self.n - 2), np.clip(iz, 0, self.n - 2)
        tx, tz = (fx - ix).astype(F), (fz - iz).astype(F)
        t = self.tex[lvl]
        a, b = t[iz, ix], t[iz, ix + 1]
        c, d = t[iz + 1, ix], t[iz + 1, ix + 1]
        tx, tz = tx[:, None], tz[:, None]
        top = a + (b - a) * tx
        v = top + ((c + (d - c) * tx) - top) * tz
        return np.where(ok[:, None], v, F(0))

    def coverage(self, x, z, w_far):
        out = np.zeros((len(x), 2), F)
        m0, m1 = w_far < 1, w_far > 0
        if m0.any():
            out[m0] = self.sample(x[m0], z[m0], 0) * (1 - w_far[m0])[:, None]
        if m1.any():
            out[m1] += self.sample(x[m1], z[m1], 1) * w_far[m1][:, None]
        return out

    def density(self, x, z, h, w_far):
        ct = self.coverage(x, z, w_far)
        c, top = ct[:, 0], ct[:, 1]
        # noise whose pattern drifts with height, so the sides bulge instead of
        # looking like extruded columns (fades out far away where it would alias)
        wob = self.per.n2(x * 2.4 + h * 2.2, z * 2.4 - h * 1.9) * (1 - w_far)
        return (smoothstep(0.0, 0.1, top * (0.9 + 0.22 * wob) - h) * smoothstep(-0.03, 0.05, h)
                * smoothstep(0.03, 0.3, c + 0.1 * wob)).astype(F)

    def trace(self, d, sdir, sun_col, amb_top, amb_bot):
        N = len(d)
        y = d[:, 1]
        hor = np.sqrt(np.maximum(1 - y * y, 1e-9))
        t0 = (self.base - 0.04) / y
        t1 = (self.base + self.tmax) / y
        span = t1 - t0
        n_h = span * hor / np.maximum(0.045, 0.006 * t0 * hor)
        n_v = span * y / 0.05
        nsteps = np.clip(np.ceil(np.maximum(n_h, n_v)), 8, 220).astype(np.int64)
        dt = span / nsteps
        w_far = smoothstep(14.0, 32.0, t0 * hor).astype(F)
        sigma = 24.0
        cosg = d @ sdir

        def hg(g, c):
            return (1 - g * g) / (1 + g * g - 2 * g * c) ** 1.5

        phase = np.minimum(0.72 * hg(0.6, cosg) + 0.28 * hg(-0.25, cosg), 4.5)
        col = np.zeros((N, 3), F)
        trans = np.ones(N, F)
        dacc = np.zeros(N)
        wacc = np.zeros(N)
        light_steps = [(0.06, 0.06), (0.16, 0.10), (0.30, 0.14), (0.50, 0.20), (0.80, 0.30)]
        jitter = np.random.default_rng(3).random(N)  # trades step banding for fine grain
        active = np.arange(N)
        k = 0
        while active.size:
            a = active
            t = t0[a] + dt[a] * (k + jitter[a])
            x, z = d[a, 0] * t, d[a, 2] * t
            h = y[a] * t - self.base
            rho = self.density(x, z, h, w_far[a])
            m = rho > 0.004
            if m.any():
                am = a[m]
                xm, zm, hm, rm, wm = x[m], z[m], h[m], rho[m], w_far[am]
                od = np.zeros(len(am), F)
                for sj, ds in light_steps:
                    od += self.density(xm + sdir[0] * sj, zm + sdir[2] * sj, hm + sdir[1] * sj, wm) * F(ds)
                sun_t = np.exp(-sigma * 0.55 * od)
                powder = 1.0 - np.exp(-sigma * rm * 0.25)
                sun = sun_t * phase[am] * (0.35 + 0.65 * powder)
                hf = np.clip(hm / self.tmax, 0, 1)[:, None]
                S = sun_col[None] * sun[:, None] + amb_bot[None] * (1 - hf) + amb_top[None] * hf
                st = 1.0 - np.exp(-sigma * rm * dt[am])
                wgt = trans[am] * st
                col[am] += (wgt[:, None] * S).astype(F)
                dacc[am] += wgt * t[m] * hor[am]
                wacc[am] += wgt
                trans[am] *= (1.0 - st).astype(F)
            k += 1
            keep = (trans[a] > 0.015) & (k < nsteps[a])
            active = a[keep]
        alpha = 1.0 - trans
        dist = np.where(wacc > 0, dacc / np.maximum(wacc, 1e-9), t0 * hor)
        col = col / np.maximum(alpha, 1e-4)[:, None]
        return alpha, col, dist


class ClearDay(Sky):
    id = "clear_day"
    name = "Clear Day (generated)"
    blurb = "Bright midday: deep blue zenith to a pale horizon, fluffy cumulus, distant blue hills."
    sun = (-48.0, 52.0)
    sun_color = (255, 247, 235)
    sun_irradiance = 4.0
    env_mean = 0.9

    def prepare(self, W, H):
        self.clouds = CumulusField(self.p)

    def shade(self, d, lon, el, px):
        sdir = direction(*self.sun)
        y = d[:, 1]
        eld = np.degrees(el)
        cosg = d @ sdir
        gam = np.arccos(np.clip(cosg, -1, 1))
        sky = ramp(eld, [(-2, C(206, 218, 230)), (0, C(222, 232, 242)), (2, C(204, 222, 242)), (6, C(170, 202, 240)),
                         (14, C(126, 174, 234)), (28, C(84, 142, 226)), (50, C(56, 114, 212)), (90, C(40, 94, 198))])
        # Rayleigh: darker ~90deg from the sun, brighter around it
        sky = sky * (0.88 + 0.12 * cosg[:, None] ** 2).astype(F)
        glow = 0.75 * np.exp(-gam / 0.045) + 0.28 * np.exp(-gam / 0.25) + 0.08 * np.exp(-gam / 0.8)
        sky += (C(255, 250, 238) * glow[:, None]).astype(F)
        disk, _ = sun_disk(d, sdir, math.radians(0.55), px)
        sky = over(sky, np.broadcast_to(C(255, 255, 250) * 1.0, sky.shape).astype(F), disk)

        upm = y > 0.012
        if upm.any():
            alpha, ccol, dist = self.clouds.trace(d[upm], sdir, C(255, 250, 240) * 1.25,
                                                  C(196, 210, 232), C(132, 146, 172))
            hz = sky[upm]
            # aerial perspective: far clouds sink into the horizon haze
            ap = (1.0 - np.exp(-dist / 32.0))[:, None]
            ccol = ccol * (1 - 0.85 * ap) + (hz * 1.03 + 0.04) * (0.85 * ap)
            alpha = alpha * smoothstep(0.012, 0.04, y[upm])
            sky[upm] = over(hz, ccol.astype(F), alpha.astype(F))

        out = sky
        for base, amp, rad, seed, col, hz in [(0.2, 1.3, 2.6, 4.0, C(150, 172, 200), 0.55),
                                              (-0.5, 1.2, 4.0, 9.0, C(104, 128, 136), 0.3)]:
            n = circle_noise(self.p, lon, rad, 5, seed_off=seed)
            h = base + amp * (0.5 + 0.6 * n)
            cov = layer_silhouette(lon, eld, h, np.degrees(px), soft=1.2)
            depth = np.clip((h - eld) / 2.0, 0, 1)
            c = mix(col, sky, F(hz) * (1 - 0.6 * depth))
            out = over(out, c, cov)
        floor = ramp(-eld, [(0, C(150, 168, 160)), (4, C(118, 140, 116)), (15, C(96, 120, 92)), (90, C(80, 100, 76))])
        out = over(out, floor, smoothstep(-1.5, -4.5, eld).astype(F))
        return out


SKIES = {cls.id: cls for cls in [OasisDusk, AuroraNight, PastelDawn, CyberDusk, ClearDay]}


# ─── rendering + files ───────────────────────────────────────────────────────

def render(sky: Sky, W, H, chunk_rows=64):
    sky.W, sky.H = W, H
    sky.prepare(W, H)
    if isinstance(sky, AuroraNight):
        cols = ((np.arange(W) + 0.5) / W - 0.5) * TAU
        hits = sky._crossings(cols)
        sky.max_hits = max(1, max(len(h) for c in hits for h in c))
        sky.col_r, sky.col_s, sky.col_sin = [], [], []
        for c in hits:
            rs, ss, ns = [], [], []
            for k in range(sky.max_hits):
                rs.append(np.array([h[k][0] if len(h) > k else -1.0 for h in c]))
                ss.append(np.array([h[k][1] if len(h) > k else 0.0 for h in c]))
                ns.append(np.array([h[k][2] if len(h) > k else 1.0 for h in c]))
            sky.col_r.append(rs)
            sky.col_s.append(ss)
            sky.col_sin.append(ns)
        sky._aur_full = np.zeros((H, W, 3), F)
        sky._sky_mask = np.ones((H, W, 1), F)
    img = np.zeros((H, W, 3), F)
    px = math.pi / H
    for r0 in range(0, H, chunk_rows):
        r1 = min(H, r0 + chunk_rows)
        d, lon, el = pixel_dirs(W, H, r0, r1)
        rgb = sky.shade(d, lon, el, px)
        img[r0:r1] = rgb.reshape(r1 - r0, W, 3)
        if isinstance(sky, AuroraNight):
            sky._aur_full[r0:r1] = sky._aur_chunk.reshape(r1 - r0, W, 3)
            eld = np.degrees(el)
            hill = 0.25 + 0.9 * circle_noise(sky.p, lon, 2.5, 3) + 0.4
            h = hill + sky._trees(lon)
            cov = layer_silhouette(lon, eld, h, np.degrees(px), soft=1.0)
            sky._sky_mask[r0:r1, :, 0] = (1 - cov).reshape(r1 - r0, W)
    sky.post(img)
    return np.maximum(img, 0)


def to_srgb8(img, seed=0):
    rng = np.random.default_rng(seed)
    s = linear_to_srgb(img) * 255.0
    s += rng.random(s.shape, dtype=np.float32) - rng.random(s.shape, dtype=np.float32)  # TPDF dither
    return np.clip(np.round(s), 0, 255).astype(np.uint8)


def area_down(img, f):
    H, W, c = img.shape
    return img.reshape(H // f, f, W // f, f, c).mean(axis=(1, 3))


def hemisphere_irradiance(img):
    H, W, _ = img.shape
    lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    w = np.where(lat > 0, np.sin(lat) * np.cos(lat), 0.0) * (TAU / W) * (math.pi / H)
    return float((lum * w[:, None]).sum())


def upper_mean(img):
    H, W, _ = img.shape
    lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    lum = img @ np.array([0.2126, 0.7152, 0.0722])
    w = np.where(lat > 0, np.cos(lat), 0.0)
    return float((lum * w[:, None]).sum() / (w.sum() * W))


def env_map(sky: Sky, img, size=1024):
    env = area_down(img, img.shape[1] // size).astype(np.float64)
    env *= sky.env_mean / max(upper_mean(env), 1e-6)
    if sky.sun and sky.sun_irradiance > 0:
        h, w = env.shape[:2]
        d, _, _ = pixel_dirs(w, h, 0, h)
        sdir = direction(*sky.sun)
        ang = np.arccos(np.clip(d @ sdir, -1, 1))
        sig = math.radians(sky.sun_sigma_deg)
        k = np.exp(-0.5 * (ang / sig) ** 2)
        lat = (0.5 - (np.arange(h) + 0.5) / h) * math.pi
        dO = (np.cos(lat) * (TAU / w) * (math.pi / h))[:, None].repeat(w, 1).reshape(-1)
        k /= (k * dO).sum()
        sc = C(*sky.sun_color)
        sc = sc / (sc @ np.array([0.2126, 0.7152, 0.0722]))
        env += (k[:, None] * sky.sun_irradiance * sc[None]).reshape(h, w, 3)
    return env.astype(np.float32)


def write_hdr(path, img):
    """Radiance RGBE with standard per-channel run-length encoding."""
    H, W, _ = img.shape
    m = img.max(axis=2)
    mant, ex = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0.0)
    rgbe = np.zeros((H, W, 4), np.uint8)
    rgbe[..., :3] = np.clip(img * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    out = bytearray(b"#?RADIANCE\n# Oasis generate-skies.py\nFORMAT=32-bit_rle_rgbe\n\n")
    out += b"-Y %d +X %d\n" % (H, W)
    for y in range(H):
        out += bytes([2, 2, W >> 8, W & 255])
        for c in range(4):
            out += _rle(rgbe[y, :, c])
    Path(path).write_bytes(bytes(out))


def _rle(row):
    data = row.tobytes()
    n = len(data)
    out = bytearray()
    i = 0
    while i < n:
        # find next run of >= 4
        j = i
        run_start, run_len = n, 0
        while j < n:
            k = j + 1
            while k < n and data[k] == data[j] and k - j < 127:
                k += 1
            if k - j >= 4:
                run_start, run_len = j, k - j
                break
            j = k
        # literal dump up to the run
        while i < run_start:
            cnt = min(128, run_start - i)
            out.append(cnt)
            out += data[i:i + cnt]
            i += cnt
        if run_len:
            out.append(128 + run_len)
            out.append(data[run_start])
            i = run_start + run_len
    return bytes(out)


def perspective(img_srgb8, yaw, pitch, fov=60.0, W=1280, H=720):
    """Pinhole view from the equirect (for previews only)."""
    src = img_srgb8.astype(np.float32)
    h, w = src.shape[:2]
    fwd = direction(yaw, pitch)
    right = np.cross(fwd, [0, 1, 0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    th = math.tan(math.radians(fov) / 2)
    xs = (np.arange(W) + 0.5) / W * 2 - 1
    ys = 1 - (np.arange(H) + 0.5) / H * 2
    xs, ys = np.meshgrid(xs * th * W / H, ys * th)
    d = fwd[None, None] + xs[..., None] * right + ys[..., None] * up
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    u = (np.arctan2(d[..., 2], d[..., 0]) / TAU + 0.5) * w - 0.5
    v = (0.5 - np.arcsin(np.clip(d[..., 1], -1, 1)) / math.pi) * h - 0.5
    x0 = np.floor(u).astype(int)
    y0 = np.clip(np.floor(v).astype(int), 0, h - 2)
    fx, fy = (u - x0)[..., None], np.clip(v - y0, 0, 1)[..., None]
    x0 %= w
    x1 = (x0 + 1) % w
    a = src[y0, x0] * (1 - fx) + src[y0, x1] * fx
    b = src[y0 + 1, x0] * (1 - fx) + src[y0 + 1, x1] * fx
    return np.clip(a * (1 - fy) + b * fy, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", default=list(SKIES))
    ap.add_argument("--preview", action="store_true", help="1024x512, write to --out only")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--views", default="", help="also save perspective previews to this folder")
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    W, H = (1024, 512) if args.preview else (4096, 2048)
    for sid in args.ids:
        sky = SKIES[sid]()
        img = render(sky, W, H)
        s8 = to_srgb8(img, seed=len(sid))
        jpg = out / f"{sid}.jpg"
        Image.fromarray(s8).save(jpg, quality=args.quality, subsampling=0, optimize=True)
        msg = f"{sid}: {jpg.name} {jpg.stat().st_size / 1e6:.2f} MB"
        if not args.preview:
            env = env_map(sky, img)
            hdr = out / f"{sid}_env.hdr"
            write_hdr(hdr, env)
            msg += f", {hdr.name} {hdr.stat().st_size / 1e6:.2f} MB"
        print(msg, flush=True)
        if args.views:
            vd = Path(args.views)
            vd.mkdir(parents=True, exist_ok=True)
            yaw0 = sky.sun[0] if sky.sun else -60.0
            for name, yaw, pitch in [("front", yaw0, 8), ("back", yaw0 + 180, 8), ("up", yaw0 + 90, 55)]:
                Image.fromarray(perspective(s8, yaw, pitch)).save(vd / f"{sid}_{name}.jpg", quality=88)
            Image.fromarray(s8).resize((1024, 512), Image.LANCZOS).save(vd / f"{sid}_equi.jpg", quality=88)


if __name__ == "__main__":
    main()
