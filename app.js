(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = { results: [], risk: "all", tier: "all", major: "all", sort: "fit", profile: null };
  const tierNames = { "985": "985高校", "211": "211 / 双一流", key: "传统重点本科" };
  const goalNames = { tech: "技术就业", teacher: "教师编制", public: "考公法政", medicine: "医学长期培养", graduate: "考研深造" };
  const riskOrder = { "稳": 0, "冲": 1, "保": 2 };

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function number(value) { return new Intl.NumberFormat("zh-CN").format(value); }

  function renderProvinceOptions() {
    const selected = new Set(["北京", "上海", "江苏", "浙江", "湖北", "湖南", "广东", "四川", "重庆", "陕西", "山东", "安徽", "福建"]);
    $("#province-options").innerHTML = window.TARGET_PROVINCES.map(province => `
      <label><input type="checkbox" name="target-province" value="${province}" ${selected.has(province) ? "checked" : ""}><span>${province}</span></label>
    `).join("");
  }

  function renderMajorPanels() {
    const render = keys => keys.map(key => {
      const major = window.MAJOR_CATALOG[key];
      return `<div class="major-mini" style="--dot:${major.color}"><i></i><div><strong>${major.name}</strong><small>${major.outlook}</small></div></div>`;
    }).join("");
    $("#future-majors").innerHTML = render(window.FUTURE_MAJOR_KEYS);
    $("#risk-majors").innerHTML = render(window.RISK_MAJOR_KEYS);
  }

  function renderSources() {
    $("#source-list").innerHTML = window.DATA_SOURCES.map(source => `
      <div class="source-item"><a href="${source.url}" target="_blank" rel="noopener">${source.title} ↗</a><p>${source.note}</p></div>
    `).join("");
  }

  function validate() {
    const score = Number($("#score").value);
    const rank = Number($("#rank").value);
    let valid = true;
    $("#score-error").textContent = "";
    $("#rank-error").textContent = "";
    if (!Number.isFinite(score) || score < 0 || score > 750) { $("#score-error").textContent = "请输入0—750之间的有效分数"; valid = false; }
    if (!Number.isInteger(rank) || rank < 1 || rank > 300000) { $("#rank-error").textContent = "请输入有效的湖北省内位次"; valid = false; }
    return valid;
  }

  function getProfile() {
    const provinces = $$("input[name='target-province']:checked").map(input => input.value);
    return {
      province: $("#candidate-province").value,
      year: Number($("#exam-year").value),
      subject: $("#subject").value,
      elective: $("#elective").value,
      score: Number($("#score").value),
      rank: Number($("#rank").value),
      provinces: provinces.length ? provinces : [...window.TARGET_PROVINCES],
      goal: $("input[name='goal']:checked").value,
      longStudy: $("#long-study").checked
    };
  }

  function classify(lineRank, candidateRank) {
    const delta = lineRank - candidateRank;
    if (delta < -5000) return null;
    if (delta < -900) return "冲";
    if (delta <= 2200) return "稳";
    return "保";
  }

  function rankMajor(key, profile) {
    const major = window.MAJOR_CATALOG[key];
    if (!major) return -999;
    let score = major.score;
    if (major.fit.includes(profile.goal)) score += 16;
    if (profile.goal === "teacher" && major.field !== "师范教育") score -= 22;
    if (profile.goal === "medicine" && major.field !== "医学健康") score -= 18;
    if (!profile.longStudy && /读研|硕博|长期培养|长学制/.test(major.study)) score -= 14;
    if (major.level === "高风险") score -= 18;
    return score;
  }

  function buildResults(profile) {
    return window.ADMISSIONS_HUBEI
      .filter(item => item.subject === profile.subject && profile.provinces.includes(item.province))
      .filter(item => profile.subject === "历史" || profile.elective === "化学" || item.requirement.includes("不限"))
      .map(item => {
        const risk = classify(item.rank, profile.rank);
        if (!risk) return null;
        const majors = item.majors
          .filter(key => window.MAJOR_CATALOG[key])
          .map(key => ({ key, ...window.MAJOR_CATALOG[key], fitScore: rankMajor(key, profile) }))
          .sort((a, b) => b.fitScore - a.fitScore);
        const goalBoost = majors.some(major => major.fit.includes(profile.goal)) ? 12 : 0;
        const fitScore = item.strength + goalBoost + Math.max(-20, Math.min(20, (item.rank - profile.rank) / 700));
        return { ...item, risk, delta: item.rank - profile.rank, majors, fitScore };
      })
      .filter(Boolean);
  }

  function profileVerdict(profile, results) {
    const counts = { "冲": 0, "稳": 0, "保": 0 };
    results.forEach(item => counts[item.risk]++);
    let headline = "位次有选择，别拿985冷门专业换一个模糊未来。";
    let quote = "学校负责给你敲门砖，专业负责让你进门以后不挨饿。";
    if (profile.goal === "teacher") { headline = "目标既然是教师编制，就先找公费师范项目，不要拿普通师范冒充包分配。"; quote = "想当老师，先看项目有没有编制通道，再看学校名字好不好听。"; }
    if (profile.goal === "medicine") { headline = profile.longStudy ? "能接受长培养再学医，先看临床层次和附属医院。" : "不接受长学制和规培，临床医学先别碰。"; quote = "学医不是四年换工作，是拿青春换职业壁垒。"; }
    if (profile.goal === "public") { headline = "考公路线优先法学、汉语言和明确招录专业，泛管理别自我感动。"; quote = "专业名字越宽，毕业时的出口往往越需要自己硬找。"; }
    if (profile.goal === "graduate") { headline = "既然准备读研，本科优先平台和基础，不追短期热门名词。"; quote = "研究生不是本科选错后的橡皮擦，方向得从第一天就想明白。"; }
    return { counts, headline, quote };
  }

  function renderVerdict(profile, results) {
    const { counts, headline, quote } = profileVerdict(profile, results);
    $("#candidate-score").textContent = profile.score;
    $("#candidate-summary").textContent = `${profile.province} · 首选${profile.subject} · 全省第${number(profile.rank)}名 · ${goalNames[profile.goal]}`;
    $("#verdict-text").textContent = headline;
    $("#verdict-quote").textContent = quote;
    $("#verdict-tags").innerHTML = `<span>位次优先</span><span>${profile.elective === "化学" ? "可报物化组" : "未选化学，理工专业大幅受限"}</span><span>${profile.longStudy ? "接受长期培养" : "就业周期优先"}</span>`;
    $("#reach-count").textContent = counts["冲"];
    $("#match-count").textContent = counts["稳"];
    $("#safe-count").textContent = counts["保"];
    $("#total-count").textContent = results.length;
  }

  function tierLabel(tier) { return tierNames[tier] || tier; }
  function riskColor(risk) { return risk === "冲" ? "#eb6b3a" : risk === "稳" ? "#d59b2e" : "#2c7a67"; }

  function majorPill(major) {
    return `<span class="major-pill" style="--major-color:${major.color}" title="${escapeHtml(major.outlook)}"><b></b>${escapeHtml(major.name)} · ${major.level}</span>`;
  }

  function cardSummary(item, profile) {
    if (profile.goal === "teacher" && item.majors.some(m => m.field === "师范教育")) return "教师路线匹配；公费师范、优师专项与普通批必须分开核验。";
    if (item.name === "东华大学" && profile.subject === "物理") return "2025学校物化2最低603，但计算机、电子最低607；你的位次要按专业再留余量。";
    if (item.risk === "冲") return "可以冲，但别把它当稳妥项；专业组和调剂去向必须能接受。";
    if (item.risk === "稳") return "历史位置基本匹配，热门专业仍要在学校线之上再留位次。";
    return "位次有安全边际，适合承担保底任务；保学校也要保专业质量。";
  }

  function renderCard(item, profile) {
    const deltaText = item.delta >= 0 ? `你领先历史线约 ${number(item.delta)} 位` : `你落后历史线约 ${number(Math.abs(item.delta))} 位`;
    const topMajors = item.majors.slice(0, 4);
    const detailMajors = item.majors.slice(0, 2);
    return `
      <article class="college-card" data-id="${item.id}" style="--risk-color:${riskColor(item.risk)}">
        <div class="college-top">
          <div>
            <div class="college-title-line"><h4>${escapeHtml(item.name)}</h4><span class="tier-tag">${tierLabel(item.tier)}</span><span class="risk-tag">${item.risk}</span></div>
            <p class="college-meta">${item.province} · ${item.city}　|　${escapeHtml(item.group)}　|　${item.requirement}</p>
          </div>
          <div class="rank-box"><small>2025最低投档</small><strong>${item.score}分 / ${number(item.rank)}名</strong><span class="rank-delta">${deltaText}</span></div>
        </div>
        <div class="college-rule"><span>数据年份：2025</span><span>匹配依据：省内位次</span><span>样本强度：${item.strength}/100</span></div>
        <div class="major-row">${topMajors.map(majorPill).join("") || "<span class='major-pill'>该样本暂无专业标签</span>"}</div>
        <div class="college-bottom"><p>${cardSummary(item, profile)}</p><button class="detail-button" type="button">展开判断 ↓</button></div>
        <div class="college-detail">
          <div class="detail-block"><strong>学校与专业组</strong><p>${escapeHtml(item.note)}</p></div>
          <div class="detail-block"><strong>优先专业怎么选</strong><p>${detailMajors.map(m => `${m.name}：${m.outlook}`).join(" ") || "请查看当年招生计划。"}</p></div>
          <div class="detail-block"><strong>培养周期</strong><p>${detailMajors.map(m => `${m.name}—${m.study}`).join(" ") || "暂无"}</p></div>
          <div class="detail-block"><strong>AI与行业风险</strong><p>${detailMajors.map(m => `${m.name}—${m.aiRisk}`).join(" ") || "暂无"}</p></div>
        </div>
      </article>`;
  }

  function filteredResults() {
    let list = [...state.results];
    if (state.risk !== "all") list = list.filter(item => item.risk === state.risk);
    if (state.tier !== "all") list = list.filter(item => item.tier === state.tier);
    if (state.major !== "all") list = list.filter(item => item.majors.some(major => major.field === state.major));
    if (state.sort === "rank") list.sort((a, b) => a.rank - b.rank);
    else if (state.sort === "employment") list.sort((a, b) => (b.majors[0]?.fitScore || 0) - (a.majors[0]?.fitScore || 0));
    else list.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || b.fitScore - a.fitScore);
    return list;
  }

  function renderList() {
    const list = filteredResults();
    $("#visible-count").textContent = `当前显示 ${list.length} 所样本院校`;
    $("#college-list").innerHTML = list.map(item => renderCard(item, state.profile)).join("");
    $("#empty-state").classList.toggle("hidden", list.length > 0);
    $$(".detail-button").forEach(button => button.addEventListener("click", () => {
      const card = button.closest(".college-card");
      const open = card.classList.toggle("open");
      button.textContent = open ? "收起判断 ↑" : "展开判断 ↓";
    }));
  }

  function runFinder(event) {
    event.preventDefault();
    if (!validate()) return;
    const profile = getProfile();
    const results = buildResults(profile);
    state.profile = profile;
    state.results = results;
    state.risk = state.tier = state.major = "all";
    state.sort = "fit";
    $$("#risk-filter button").forEach(button => button.classList.toggle("active", button.dataset.value === "all"));
    $("#tier-filter").value = $("#major-filter").value = "all";
    $("#sort-filter").value = "fit";
    renderVerdict(profile, results);
    renderList();
    $("#results").classList.remove("hidden");
    setTimeout(() => $("#results").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function bindEvents() {
    $("#finder-form").addEventListener("submit", runFinder);
    $("#select-all-regions").addEventListener("click", () => {
      const inputs = $$("input[name='target-province']");
      const allSelected = inputs.every(input => input.checked);
      inputs.forEach(input => { input.checked = !allSelected; });
      $("#select-all-regions").textContent = allSelected ? "选择全国主要地区" : "清空地区";
    });
    $("#edit-profile").addEventListener("click", () => $("#finder-form").scrollIntoView({ behavior: "smooth", block: "center" }));
    $$("#risk-filter button").forEach(button => button.addEventListener("click", () => {
      state.risk = button.dataset.value;
      $$("#risk-filter button").forEach(item => item.classList.toggle("active", item === button));
      renderList();
    }));
    $("#tier-filter").addEventListener("change", event => { state.tier = event.target.value; renderList(); });
    $("#major-filter").addEventListener("change", event => { state.major = event.target.value; renderList(); });
    $("#sort-filter").addEventListener("change", event => { state.sort = event.target.value; renderList(); });
    $("#show-sources").addEventListener("click", () => $("#source-dialog").showModal());
    $("#subject").addEventListener("change", event => {
      const isHistory = event.target.value === "历史";
      $("#elective").disabled = isHistory;
      if (isHistory) $("#elective").value = "不限";
    });
  }

  renderProvinceOptions();
  renderMajorPanels();
  renderSources();
  bindEvents();
})();
