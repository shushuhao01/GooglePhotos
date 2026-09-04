#!/usr/bin/env python3
# 生成扩展图标（16/32/48/128 PNG），纯标准库实现。
# 风格：Apple Photos (iOS 相册) 八瓣彩色风车花瓣，围绕中心旋转。
import os, struct, zlib, math

def make_png(path, size, px_fn):
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter: None
        for x in range(size):
            r, g, b = px_fn(x + 0.5, y + 0.5, size)
            row.append(r & 0xff)
            row.append(g & 0xff)
            row.append(b & 0xff)
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

# ---- Apple Photos 风车花瓣 ----
# 每个花瓣是一个绕中心旋转的"泪滴/椭圆"，N 片各旋转一个角度。
# 颜色沿花瓣由浅到深渐变，整体呈 Apple Photos 的彩虹配色。

# 八瓣各自的主色（接近 Apple Photos：亮蓝、浅蓝、青、绿、黄、橙、粉紫、紫）
PETAL_COLORS = [
    (245, 93, 117),   # 玫红
    (252, 152, 78),   # 橙
    (250, 204, 56),   # 黄
    (144, 200, 74),   # 苹果绿
    (64, 196, 139),   # 青绿
    (52, 190, 229),   # 青蓝
    (88, 144, 255),   # 蓝
    (155, 106, 244),  # 紫
]

N_PETALS = 8

def petal_field(px, py, size, cx, cy):
    """判断点 (px,py) 是否落在某个花瓣内；返回 (命中, 该点的颜色渐变值 t, 花瓣索引)"""
    # 花瓣中心距圆心的半径（花瓣圆环半径）
    ring_r = size * 0.27
    dx, dy = px - cx, py - cy
    r = math.hypot(dx, dy)
    if r > size * 0.50:  # 最外圈截断
        return (False, 0, -1)
    ang = math.atan2(dy, dx)
    # 判断是否落在某个花瓣内：花瓣轴心方位 = 花瓣索引 * (2π/N)
    for k in range(N_PETALS):
        center_ang = (k * 2 * math.pi / N_PETALS)
        # 花瓣沿径向呈椭圆；点到花瓣轴心的角差
        da = ang - center_ang
        # 归一化到 [-π, π]
        while da > math.pi: da -= 2 * math.pi
        while da < -math.pi: da += 2 * math.pi
        # 径向投影（沿轴心方向）
        along = (dx * math.cos(center_ang) + dy * math.sin(center_ang)) - ring_r  # 相对花瓣中心
        # 切向距离
        tang = (-dx * math.sin(center_ang) + dy * math.cos(center_ang))
        # 花瓣半轴：长短轴（椭圆形花瓣）
        la = size * 0.23   # 长半轴（径向）
        sa = size * 0.115  # 短半轴（切向）
        # 椭圆内判定（含旋转带来的整体倾斜微调由 long axis 控制）
        if (along * along) / (la * la) + (tang * tang) / (sa * sa) <= 1.0:
            # 渐变参数：径向从内到外 0..1
            t = max(0.0, min(1.0, (along + la) / (2 * la)))
            return (True, t, k)
    return (False, 0, -1)

def color_at(t, k):
    """花瓣内由浅色到主色渐变"""
    c0 = PETAL_COLORS[k]
    # 浅色端（近白色系）+ 主色
    light = (255, 255, 255)
    r = int(light[0] + (c0[0] - light[0]) * t)
    g = int(light[1] + (c0[1] - light[1]) * t)
    b = int(light[2] + (c0[2] - light[2]) * t)
    return (r, g, b)

def build(size):
    cx = size * 0.5
    cy = size * 0.5
    S = 4  # 超采样抗锯齿

    def px(x, y, size):
        # 圆圆底（浅灰白），模拟 Apple 图标衬底（也可透明）。用近白底。
        acc = [0, 0, 0]
        n = 0
        for sy in range(S):
            for sx in range(S):
                fx = x - 0.5 + (sx + 0.5) / S
                fy = y - 0.5 + (sy + 0.5) / S
                r0 = math.hypot(fx - cx, fy - cy)
                if r0 > size * 0.5:
                    continue  # 透明外部
                n += 1
                hit, t, k = petal_field(fx, fy, size, cx, cy)
                if hit:
                    cr, cg, cb = color_at(t, k)
                else:
                    # 空白花瓣间区域：半透明白衬底（浅灰）
                    cr, cg, cb = (248, 249, 251)
                acc[0] += cr; acc[1] += cg; acc[2] += cb
        if n == 0:
            return (0, 0, 0)
        return (acc[0] // n, acc[1] // n, acc[2] // n)
    return px

def main():
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        fn = build(size)
        make_png(os.path.join(out, 'icon%d.png' % size), size, fn)
        print('generated icon%d.png' % size)

if __name__ == '__main__':
    main()
