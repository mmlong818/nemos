/** 设置页「提醒与后台」：免打扰时段、动态每天自动生成。开机自启在桌面版托盘菜单里。 */
(() => {
  const $ = (q) => document.querySelector(q);
  const form = $("#proactiveForm");
  if (!form) return;
  const status = $("#proactiveStatus");
  function fill(data) {
    form.elements.quietEnabled.checked = !!data.quietHours.enabled;
    form.elements.quietStart.value = data.quietHours.start;
    form.elements.quietEnd.value = data.quietHours.end;
    form.elements.feedEnabled.checked = !!data.feedSchedule.enabled;
    form.elements.feedTime.value = data.feedSchedule.time;
    form.elements.tellMe.value = (data.topics && data.topics.tellMe) || "";
    form.elements.neverMention.value = (data.topics && data.topics.neverMention) || "";
    $("#proactiveQuietNow").textContent = data.quietNow ? "现在正处于免打扰时段：托盘通知会攒到时段结束后再弹。" : "";
  }
  async function load() {
    try { const r = await fetch("/api/proactive"); if (!r.ok) throw 0; fill(await r.json()); status.textContent = ""; }
    catch { status.textContent = "设置暂时读不到。"; }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const body = {
      quietHours: { enabled: form.elements.quietEnabled.checked, start: form.elements.quietStart.value, end: form.elements.quietEnd.value },
      feedSchedule: { enabled: form.elements.feedEnabled.checked, time: form.elements.feedTime.value },
      topics: { tellMe: form.elements.tellMe.value, neverMention: form.elements.neverMention.value },
    };
    try {
      const r = await fetch("/api/proactive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "没保存上");
      fill(data);
      status.textContent = "已保存。";
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  load();
})();
