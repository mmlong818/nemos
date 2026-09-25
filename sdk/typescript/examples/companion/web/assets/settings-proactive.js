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

  // 帮我盯着：清单和开关随「保存」一起存；「现在看一次」立即跑一轮（算进当天额度）。
  const watch = { enabled: $("#watchEnabled"), items: $("#watchItems"), interval: $("#watchInterval"), run: $("#watchRunNow"), results: $("#watchResults"), hint: $("#watchHint") };
  const STATUS = { quiet: "没新情况", alerted: "有新情况，已告诉你", failed: "这次没看成" };
  function fillWatch(data) {
    watch.enabled.checked = !!data.enabled;
    watch.items.value = (data.items || []).map((i) => i.text).join("\n");
    watch.interval.value = String(data.intervalMinutes || 120);
    // 清单是否为空在点的时候再判断：用户刚写进框里、还没保存时也能直接点。
    watch.run.disabled = !!data.running || !data.searchAvailable || !data.modelReady;
    watch.run.textContent = data.running ? "正在看…" : "现在看一次";
    if (!data.searchAvailable) watch.hint.textContent = "联网搜索没有配置，盯不了：小丑鱼不会用自己的记忆冒充查过了。";
    else watch.hint.textContent = "每件事每次联网搜一次、调用一次模型（会消耗额度），今天还能看 " + data.remainingChecks + " 次；和上次一样就不出声。只在应用开着时跑。";
    watch.results.innerHTML = "";
    for (const item of data.items || []) {
      if (!item.lastCheckedAt) continue;
      const li = document.createElement("li");
      const when = new Date(item.lastCheckedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      li.textContent = item.text + " · " + when + " · " + (STATUS[item.lastStatus] || "") + (item.lastSummary ? "：" + item.lastSummary : "");
      watch.results.appendChild(li);
    }
  }
  async function loadWatch() { try { const r = await fetch("/api/watch"); if (r.ok) fillWatch(await r.json()); } catch {} }
  async function saveWatch(reload = true) {
    const r = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: watch.enabled.checked, intervalMinutes: Number(watch.interval.value), items: watch.items.value }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "盯着的清单没保存上");
    if (reload) await loadWatch();
  }
  form.addEventListener("submit", () => { saveWatch().catch((error) => { status.textContent = error.message; }); });
  watch.run.addEventListener("click", async () => {
    if (!watch.items.value.trim()) { status.textContent = "先写一件要盯的事。"; watch.items.focus(); return; }
    watch.run.disabled = true; watch.run.textContent = "正在看…";
    try {
      // 这里保存后不刷新：刷新会把按钮提前复原成"现在看一次"，而检查还在跑。
      await saveWatch(false);
      const r = await fetch("/api/watch/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "没看成");
      status.textContent = "看了 " + data.checked + " 件，" + (data.alertCount ? data.alertCount + " 件有新情况，已在聊天里告诉你。" : "都没有新情况。");
    } catch (error) { status.textContent = error.message; }
    await loadWatch();
  });
  loadWatch();
})();
