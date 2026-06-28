(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = { results: [], risk: "all", tier: "all", major: "all", sort: "score", profile: null, rankResult: null };
  const tierNames = { "985": "985高校", "211": "211 / 双一流", key: "普通公办本科", public: "普通公办本科", private: "民办本科" };
  const goalNames = { tech: "技术就业", teacher: "教师编制", public: "考公法政", medicine: "医学长期培养", graduate: "考研深造" };
  const riskOrder = { "稳": 0, "冲": 1, "保": 2 };
  const schoolIndex = new Map((window.SCHOOL_CATALOG || []).map(school => [school.name, school]));

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function number(value) { return new Intl.NumberFormat("zh-CN").format(value); }

  function provinceConfig() { return window.PROVINCE_CONFIG[$("#candidate-province").value]; }

  function renderCandidateProvinces() {
    $("#candidate-province").innerHTML = window.ALL_PROVINCES.map(province => `<option value="${province}" ${province === "湖北" ? "selected" : ""}>${province}</option>`).join("");
  }

  function renderProvinceOptions() {
    $("#province-options").innerHTML = window.ALL_PROVINCES.map(province => `
      <label><input type="checkbox" name="target-province" value="${province}"><span>${province}</span></label>
    `).join("");
  }

  function checkboxSubject(subject, checked) {
    return `<label><input type="checkbox" name="elective-subject" value="${subject}" ${checked ? "checked" : ""}><span>${subject}</span></label>`;
  }

  function renderSubjectControls() {
    const config = provinceConfig();
    const primaryField = $("#primary-subject-field");
    const electiveField = $("#elective-field");
    $("#subject-error").textContent = "";

    if (config.mode === "3+1+2") {
      primaryField.classList.remove("hidden");
      electiveField.classList.remove("hidden");
      $("#primary-subject-label").textContent = "首选科目";
      $("#subject").innerHTML = '<option value="物理">物理</option><option value="历史">历史</option>';
      $("#elective-label").textContent = "再选科目（选2科）";
      $("#elective-options").innerHTML = config.subjects.map((subject, index) => checkboxSubject(subject, index < 2)).join("");
    } else if (config.mode === "3+3") {
      primaryField.classList.add("hidden");
      electiveField.classList.remove("hidden");
      $("#subject").innerHTML = '<option value="综合">综合改革</option>';
      $("#elective-label").textContent = "选考科目（选3科）";
      $("#elective-options").innerHTML = config.subjects.map((subject, index) => checkboxSubject(subject, index < 3)).join("");
    } else {
      primaryField.classList.remove("hidden");
      electiveField.classList.add("hidden");
      $("#primary-subject-label").textContent = "科类";
      $("#subject").innerHTML = '<option value="理科">理科</option><option value="文科">文科</option>';
      $("#elective-options").innerHTML = "";
    }

    $("#score").max = config.maxScore;
    $("#province-status").textContent = `${config.mode} · ${config.status}`;
    $("#province-status").className = `data-hint ${config.rankReady && config.admissionReady ? "ready" : "pending"}`;
    bindSubjectLimit();
    updateRankResult();
  }

  function bindSubjectLimit() {
    $$("input[name='elective-subject']").forEach(input => input.addEventListener("change", () => {
      const config = provinceConfig();
      const limit = config.mode === "3+3" ? 3 : 2;
      const checked = $$("input[name='elective-subject']:checked");
      if (checked.length > limit) input.checked = false;
      $("#subject-error").textContent = "";
      updateRankResult();
    }));
  }

  function selectedSubjects() {
    const config = provinceConfig();
    if (config.mode === "traditional") return [$("#subject").value];
    const electives = $$("input[name='elective-subject']:checked").map(input => input.value);
    return config.mode === "3+1+2" ? [$("#subject").value, ...electives] : electives;
  }

  function rankCategory() {
    const config = provinceConfig();
    return config.mode === "3+3" ? "综合" : $("#subject").value;
  }

  function lookupRank(province, category, score) {
    const table = window.RANK_TABLES_2026 && window.RANK_TABLES_2026[province];
    if (!table || !table.categories[category]) return { ok: false, reason: "该省2026官方一分一段数据尚未完成核验" };
    const ranks = table.categories[category];
    const end = Number(ranks[score]);
    if (!Number.isFinite(end)) return { ok: false, reason: "官方表中该分数行尚未完成校验，请查看数据来源" };
    const higher = Number(ranks[score + 1]);
    const start = Number.isFinite(higher) ? higher + 1 : null;
    return { ok: true, rank: end, start, end, source: table.source, updatedAt: table.updatedAt };
  }

  function updateRankResult() {
    const config = provinceConfig();
    const score = Number($("#score").value);
    const resultBox = $("#rank-result");
    state.rankResult = null;
    resultBox.className = "rank-result";
    if (!Number.isFinite(score) || score < 0 || score > config.maxScore) {
      $("#rank-value").textContent = "等待有效分数";
      $("#rank-detail").textContent = `该省总分范围为0—${config.maxScore}分`;
      return;
    }
    const result = lookupRank(config.name, rankCategory(), score);
    if (!result.ok) {
      resultBox.classList.add("unavailable");
      $("#rank-value").textContent = "暂不可查询";
      $("#rank-detail").textContent = result.reason;
      return;
    }
    state.rankResult = result;
    resultBox.classList.add("ready");
    $("#rank-value").textContent = `累计第 ${number(result.rank)} 名`;
    $("#rank-detail").textContent = result.start ? `同分位次约 ${number(result.start)}—${number(result.end)}；推荐采用末位` : `推荐采用累计末位；数据更新于${result.updatedAt}`;
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
    const config = provinceConfig();
    const score = Number($("#score").value);
    const targetProvinces = $$("input[name='target-province']:checked");
    const chosen = $$("input[name='elective-subject']:checked").length;
    const required = config.mode === "3+3" ? 3 : config.mode === "3+1+2" ? 2 : 0;
    let valid = true;
    $("#score-error").textContent = "";
    $("#subject-error").textContent = "";
    $("#province-error").textContent = "";
    if (!Number.isFinite(score) || score < 0 || score > config.maxScore) {
      $("#score-error").textContent = `请输入0—${config.maxScore}之间的有效分数`;
      valid = false;
    }
    if (chosen !== required) {
      $("#subject-error").textContent = `请选择${required}门科目`;
      valid = false;
    }
    if (!targetProvinces.length) {
      $("#province-error").textContent = "请至少选择一个目标省份";
      valid = false;
    }
    if (!state.rankResult) {
      $("#score-error").textContent = config.rankReady ? "该分数行尚未完成官方数据校验" : "该省官方位次数据尚未接入，暂不能生成建议";
      valid = false;
    }
    if (!config.admissionReady) {
      $("#province-error").textContent = "该考生省份的历史普通批投档数据尚未完成核验";
      valid = false;
    }
    return valid;
  }

  function getProfile() {
    const config = provinceConfig();
    return {
      province: config.name,
      mode: config.mode,
      year: 2026,
      subject: $("#subject").value,
      category: rankCategory(),
      subjects: selectedSubjects(),
      score: Number($("#score").value),
      rank: state.rankResult.rank,
      rankStart: state.rankResult.start,
      provinces: $$("input[name='target-province']:checked").map(input => input.value),
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

  function requirementMatches(item, profile) {
    if (item.subject !== profile.category) return false;
    if (item.requirement.includes("化学") && !profile.subjects.includes("化学")) return false;
    if (item.requirement.includes("生物") && !profile.subjects.includes("生物")) return false;
    if (item.requirement.includes("政治") && !profile.subjects.includes("思想政治")) return false;
    if (item.requirement.includes("地理") && !profile.subjects.includes("地理")) return false;
    return true;
  }

  function buildResults(profile) {
    const admissions = profile.province === "湖北" ? window.ADMISSIONS_HUBEI : [];
    return admissions
      .filter(item => profile.provinces.includes(item.province) && requirementMatches(item, profile))
      .map(item => {
        const risk = classify(item.rank, profile.rank);
        if (!risk) return null;
        const school = schoolIndex.get(item.name);
        const majors = item.majors
          .filter(key => window.MAJOR_CATALOG[key])
          .map(key => ({ key, ...window.MAJOR_CATALOG[key], fitScore: rankMajor(key, profile) }))
          .sort((a, b) => b.fitScore - a.fitScore);
        const goalBoost = majors.some(major => major.fit.includes(profile.goal)) ? 12 : 0;
        const fitScore = item.strength + goalBoost + Math.max(-20, Math.min(20, (item.rank - profile.rank) / 700));
        return { ...item, nature: school?.nature || "公办", risk, delta: item.rank - profile.rank, majors, fitScore };
      })
      .filter(Boolean);
  }

  function profileVerdict(profile, results) {
    const counts = { "冲": 0, "稳": 0, "保": 0 };
    results.forEach(item => counts[item.risk]++);
    let headline = "先按目标省份锁定学校，再在学校里挑能接受的专业组。";
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
    $("#candidate-summary").textContent = `${profile.province} · ${profile.subjects.join("+")} · 2026累计第${number(profile.rank)}名 · ${goalNames[profile.goal]}`;
    $("#verdict-text").textContent = headline;
    $("#verdict-quote").textContent = quote;
    $("#verdict-tags").innerHTML = `<span>2026官方位次</span><span>${profile.provinces.join("、")}</span><span>${profile.longStudy ? "接受长期培养" : "就业周期优先"}</span>`;
    $("#reach-count").textContent = counts["冲"];
    $("#match-count").textContent = counts["稳"];
    $("#safe-count").textContent = counts["保"];
    $("#total-count").textContent = results.length;
  }

  function tierLabel(item) {
    if (item.tier === "985" || item.tier === "211") return tierNames[item.tier];
    return item.nature === "民办" ? "民办本科" : "普通公办本科";
  }
  function riskColor(risk) { return risk === "冲" ? "#eb6b3a" : risk === "稳" ? "#d59b2e" : "#2c7a67"; }

  function majorPill(major) {
    return `<span class="major-pill" style="--major-color:${major.color}" title="${escapeHtml(major.outlook)}"><b></b>${escapeHtml(major.name)} · ${major.level}</span>`;
  }

  function cardSummary(item, profile) {
    if (profile.goal === "teacher" && item.majors.some(m => m.field === "师范教育")) return "教师路线匹配；公费师范、优师专项与普通批必须分开核验。";
    if (item.risk === "冲") return "可以冲，但别把它当稳妥项；专业组和调剂去向必须能接受。";
    if (item.risk === "稳") return "历史位置基本匹配，热门专业仍要在学校线之上再留位次。";
    return "位次有安全边际，适合承担保底任务；保学校也要保专业质量。";
  }

  function renderCard(item, profile) {
    const deltaText = item.delta >= 0 ? `你领先2025线约 ${number(item.delta)} 位` : `你落后2025线约 ${number(Math.abs(item.delta))} 位`;
    const topMajors = item.majors.slice(0, 4);
    const detailMajors = item.majors.slice(0, 2);
    return `
      <article class="college-card" data-id="${item.id}" style="--risk-color:${riskColor(item.risk)}">
        <div class="college-top">
          <div>
            <div class="college-title-line"><h4>${escapeHtml(item.name)}</h4><span class="tier-tag">${tierLabel(item)}</span><span class="risk-tag">${item.risk}</span></div>
            <p class="college-meta">${item.province} · ${item.city}　|　${escapeHtml(item.group)}　|　${item.requirement}</p>
          </div>
          <div class="rank-box"><small>2025普通批最低投档</small><strong>${item.score}分 / ${number(item.rank)}名</strong><span class="rank-delta">${deltaText}</span></div>
        </div>
        <div class="college-rule"><span>目标省份：${item.province}</span><span>匹配依据：2026位次对比2025位次</span><span>样本强度：${item.strength}/100</span></div>
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
    if (state.tier === "985" || state.tier === "211") list = list.filter(item => item.tier === state.tier);
    if (state.tier === "public") list = list.filter(item => item.nature !== "民办");
    if (state.tier === "private") list = list.filter(item => item.nature === "民办");
    if (state.major !== "all") list = list.filter(item => item.majors.some(major => major.field === state.major));
    if (state.sort === "score") list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
    else if (state.sort === "rank") list.sort((a, b) => a.rank - b.rank);
    else if (state.sort === "employment") list.sort((a, b) => (b.majors[0]?.fitScore || 0) - (a.majors[0]?.fitScore || 0));
    else list.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || b.fitScore - a.fitScore);
    return list;
  }

  function renderList() {
    const list = filteredResults();
    $("#visible-count").textContent = `当前显示 ${list.length} 个已核验专业组`;
    $("#college-list").innerHTML = list.map(item => renderCard(item, state.profile)).join("");
    $("#empty-state").classList.toggle("hidden", list.length > 0);
    if (!list.length) {
      $("#empty-title").textContent = "所选条件下没有已核验结果";
      $("#empty-message").textContent = "请检查目标省份和选科；也可能是该院校尚未进入当前考生省份的数据包。";
    }
    $$(".detail-button").forEach(button => button.addEventListener("click", () => {
      const card = button.closest(".college-card");
      const open = card.classList.toggle("open");
      button.textContent = open ? "收起判断 ↑" : "展开判断 ↓";
    }));
  }

  function runFinder(event) {
    event.preventDefault();
    updateRankResult();
    if (!validate()) return;
    const profile = getProfile();
    const results = buildResults(profile);
    state.profile = profile;
    state.results = results;
    state.risk = state.tier = state.major = "all";
    state.sort = "score";
    $$("#risk-filter button").forEach(button => button.classList.toggle("active", button.dataset.value === "all"));
    $("#tier-filter").value = $("#major-filter").value = "all";
    $("#sort-filter").value = "score";
    renderVerdict(profile, results);
    renderList();
    $("#results").classList.remove("hidden");
    setTimeout(() => $("#results").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function bindEvents() {
    $("#finder-form").addEventListener("submit", runFinder);
    $("#candidate-province").addEventListener("change", renderSubjectControls);
    $("#subject").addEventListener("change", updateRankResult);
    $("#score").addEventListener("input", updateRankResult);
    $("#select-all-regions").addEventListener("click", () => {
      const inputs = $$("input[name='target-province']");
      const allSelected = inputs.every(input => input.checked);
      inputs.forEach(input => { input.checked = !allSelected; });
      $("#select-all-regions").textContent = allSelected ? "全选" : "清空";
      $("#province-error").textContent = "";
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
  }

  renderCandidateProvinces();
  renderProvinceOptions();
  renderSubjectControls();
  renderMajorPanels();
  renderSources();
  bindEvents();
})();
