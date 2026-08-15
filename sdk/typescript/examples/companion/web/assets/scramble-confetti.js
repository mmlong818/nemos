/* Scramble OS 2026 风格漂浮像素彩纸层
 * 低密度、不挡交互、自动适配深色/减少动画偏好
 */
(() => {
  const COLORS = ["#00C896", "#FFD500", "#FF5CA8", "#9B5CFF", "#00D9E9", "#FFFFFF"];
  const N = 32;
  const REDUCED_N = 8;

  function shouldReduce() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function ensureFilter() {
    if (document.getElementById("lg-refraction")) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.innerHTML = `
      <defs>
        <filter id="lg-refraction" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="noise"></feTurbulence>
          <feGaussianBlur in="noise" stdDeviation="2.2" result="soft"></feGaussianBlur>
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="12" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
        </filter>
      </defs>
    `;
    document.body.appendChild(svg);
  }

  function start() {
    if (document.getElementById("scramble-confetti")) return;
    ensureFilter();

    // 像素彩纸默认关闭（macOS 风格下不加装饰噪点）；
    // 需要时执行 localStorage.setItem("clownfish-confetti", "1") 后刷新开启
    let enabled = false;
    try { enabled = localStorage.getItem("clownfish-confetti") === "1"; } catch (e) { /* ignore */ }
    if (!enabled) return;

    const cv = document.createElement("canvas");
    cv.id = "scramble-confetti";
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1;opacity:0.5;";
    document.body.appendChild(cv);

    const ctx = cv.getContext("2d");
    let w, h, parts;
    const reduced = shouldReduce();
    const count = reduced ? REDUCED_N : N;

    function resize() {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize, { passive: true });

    function spawn() {
      parts = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        s: 5 + Math.random() * 12,
        vx: reduced ? 0 : (Math.random() - 0.5) * 0.25,
        vy: reduced ? 0.03 : 0.08 + Math.random() * 0.28,
        rot: Math.random() * Math.PI,
        vr: reduced ? 0 : (Math.random() - 0.5) * 0.004,
        col: COLORS[(Math.random() * COLORS.length) | 0],
        a: 0.32 + Math.random() * 0.42,
      }));
    }
    spawn();

    let raf;
    function tick() {
      if (!document.hidden) {
        ctx.clearRect(0, 0, w, h);
        for (const p of parts) {
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          if (p.y - p.s > h) {
            p.y = -p.s;
            p.x = Math.random() * w;
          }
          if (p.x - p.s > w) p.x = -p.s;
          if (p.x + p.s < 0) p.x = w + p.s;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = p.a;
          ctx.fillStyle = p.col;
          ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
