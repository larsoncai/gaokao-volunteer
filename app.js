(function () {
  "use strict";

  const API_BASE = "https://api.lx91.com";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    results: [], risk: "all", tier: "all", major: "all", sort: "score", profile: null,
    rankResult: null, rankRequestId: 0, rankTimer: null, rankCache: new Map(), metaCache: new Map()
  };
  const tierNames = { "985": "985高校", "211": "211 / 双一流", key: "普通公办本科", public: "普通公办本科", private: "民办本科" };
  const goalNames = { tech: "技术就业", teacher: "教师编制", public: "考公法政", medicine: "医学长期培养", graduate: "考研深造" };
  const riskOrder = { "稳": 0, "冲": 1, "保": 2, "参考": 3 };
  const schoolIndex = new Map();
  const normalizedSchoolIndex = new Map();

  (window.SCHOOL_CATALOG || []).forEach(school => {
    schoolIndex.set(school.name, school);
    normalizedSchoolIndex.set(normalizeSchoolName(school.name), school);
  });

  function normalizeSchoolName(name) {
    return String(name || "").replace(/[（(].*?[）)]/g, "").replace(/\s+/g, "").replace(/(主校区|分校区|校区)$/g, "");
  }

  function schoolInfo(name) {
    return schoolIndex.get(name) || normalizedSchoolIndex.get(normalizeSchoolName(name));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function number(value) { return new Intl.NumberFormat("zh-CN").format(value); }
  function finite(value) { return value !== null && value !== "" && Number.isFinite(Number(value)); }
  function provinceConfig() { return window.PROVINCE_CONFIG[$("#candidate-province").value]; }

  async function apiPost(path, payload) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`数据服务返回 ${response.status}`);
    const json = await response.json();
    if (json.code !== 200) throw new Error(json.message || "数据服务暂不可用");
    return json.data;
  }

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
    $("#province-status").textContent = `${config.mode} · 正在检查可用数据`;
    $("#province-status").className = "data-hint pending";
    bindSubjectLimit();
    scheduleRankUpdate(0);
  }

  function bindSubjectLimit() {
    $$("input[name='elective-subject']").forEach(input => input.addEventListener("change", () => {
      const config = provinceConfig();
      const limit = config.mode === "3+3" ? 3 : 2;
      const checked = $$("input[name='elective-subject']:checked");
      if (checked.length > limit) input.checked = false;
      $("#subject-error").textContent = "";
      scheduleRankUpdate(0);
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

  function desiredApiSubjects(category) {
    if (category === "物理") return ["物理类", "物理", "理科", "理工"];
    if (category === "历史") return ["历史类", "历史", "文科", "文史"];
    if (category === "理科") return ["理科", "理工", "理工类", "物理类"];
    if (category === "文科") return ["文科", "文史", "文史类", "历史类"];
    return ["综合", "综合类"];
  }

  function chooseApiSubject(options, category) {
    const wanted = desiredApiSubjects(category);
    return wanted.find(item => options.includes(item)) || null;
  }

  function expandRankRows(rows) {
    const ranks = {};
    rows.forEach(row => {
      const text = String(row.score || "");
      const match = text.match(/^(\d+)(?:-(\d+))?$/);
      if (!match || !finite(row.total)) return;
      const low = Number(match[1]);
      const high = Number(match[2] || match[1]);
      for (let score = low; score <= high; score++) ranks[score] = Number(row.total);
    });
    return ranks;
  }

  async function loadRankTable(province, category, remoteOnly = false) {
    const cacheKey = `${remoteOnly ? "remote|" : ""}${province}|${category}`;
    if (state.rankCache.has(cacheKey)) return state.rankCache.get(cacheKey);

    const local = window.RANK_TABLES_2026 && window.RANK_TABLES_2026[province];
    if (!remoteOnly && local && local.categories[category]) {
      const table = { ranks: local.categories[category], year: 2026, subject: category, source: local.source, local: true };
      state.rankCache.set(cacheKey, table);
      return table;
    }

    for (const year of [2026, 2025]) {
      try {
        const subjects = await apiPost("/api/v1/meta/subjects", { province, year, source: "yifenyiduan" });
        const apiSubject = chooseApiSubject(subjects || [], category);
        if (!apiSubject) continue;
        const data = await apiPost("/api/v1/seating/list", { province, year: String(year), km: apiSubject });
        const ranks = expandRankRows(data.list || []);
        if (Object.keys(ranks).length) {
          const table = { ranks, year, subject: apiSubject, source: `${API_BASE}/api-docs`, local: false };
          state.rankCache.set(cacheKey, table);
          return table;
        }
      } catch (error) { /* 继续检查下一年份，最终回退到分数参考 */ }
    }

    const table = { ranks: null, year: 2025, subject: category, source: `${API_BASE}/api-docs`, scoreOnly: true };
    state.rankCache.set(cacheKey, table);
    return table;
  }

  async function lookupRank(province, category, score) {
    let table = await loadRankTable(province, category);
    if (table.scoreOnly) return { ok: true, rank: null, start: null, end: null, year: 2025, scoreOnly: true, source: table.source };
    let end = Number(table.ranks[score]);
    if (!Number.isFinite(end) && table.local) {
      table = await loadRankTable(province, category, true);
      if (table.scoreOnly) return { ok: true, rank: null, start: null, end: null, year: 2025, scoreOnly: true, source: table.source };
      end = Number(table.ranks[score]);
    }
    if (!Number.isFinite(end)) return { ok: false, reason: `${table.year}一分一段表中没有该分数行，请核对分数与科类` };
    const higher = Number(table.ranks[score + 1]);
    return { ok: true, rank: end, start: Number.isFinite(higher) ? higher + 1 : null, end, year: table.year, source: table.source, local: table.local };
  }

  function scheduleRankUpdate(delay) {
    clearTimeout(state.rankTimer);
    state.rankTimer = setTimeout(() => updateRankResult(), delay == null ? 280 : delay);
  }

  async function updateRankResult() {
    const requestId = ++state.rankRequestId;
    const config = provinceConfig();
    const score = Number($("#score").value);
    const resultBox = $("#rank-result");
    state.rankResult = null;
    resultBox.className = "rank-result";
    $("#rank-label").textContent = "位次数据";

    if (!Number.isFinite(score) || score < 0 || score > config.maxScore) {
      $("#rank-value").textContent = "等待有效分数";
      $("#rank-detail").textContent = `该省总分范围为0—${config.maxScore}分`;
      return null;
    }

    resultBox.classList.add("loading");
    $("#rank-value").textContent = "正在查询…";
    $("#rank-detail").textContent = "优先检查2026数据，必要时回退2025";

    try {
      const result = await lookupRank(config.name, rankCategory(), score);
      if (requestId !== state.rankRequestId) return null;
      resultBox.className = "rank-result";
      if (!result.ok) {
        resultBox.classList.add("unavailable");
        $("#rank-value").textContent = "未找到对应位次";
        $("#rank-detail").textContent = result.reason;
        return null;
      }
      state.rankResult = result;
      resultBox.classList.add(result.scoreOnly ? "historical" : "ready");
      if (result.scoreOnly) {
        $("#rank-label").textContent = "2025分数参考";
        $("#rank-value").textContent = "按历史分数生成建议";
        $("#rank-detail").textContent = "该地区未提供可核验的一分一段表，结果不显示虚构位次";
      } else {
        $("#rank-label").textContent = `${result.year}${result.year === 2026 ? "位次数据" : "历史位次参考"}`;
        $("#rank-value").textContent = `累计第 ${number(result.rank)} 名`;
        $("#rank-detail").textContent = result.start ? `同分位次约 ${number(result.start)}—${number(result.end)}；推荐采用末位` : `采用累计末位；数据年份${result.year}`;
      }
      $("#province-status").textContent = `${config.mode} · ${result.year === 2026 ? "已使用2026一分一段" : "使用2025历史数据参考"}`;
      $("#province-status").className = `data-hint ${result.year === 2026 ? "ready" : "pending"}`;
      return result;
    } catch (error) {
      if (requestId !== state.rankRequestId) return null;
      resultBox.className = "rank-result unavailable";
      $("#rank-value").textContent = "数据服务暂不可用";
      $("#rank-detail").textContent = error.message;
      $("#province-status").textContent = `${config.mode} · 数据连接失败`;
      $("#province-status").className = "data-hint pending";
      return null;
    }
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
      $("#score-error").textContent = "请等待位次数据查询完成";
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
      rankYear: state.rankResult.year,
      rankMethod: state.rankResult.scoreOnly ? "score" : "rank",
      provinces: $$("input[name='target-province']:checked").map(input => input.value),
      goal: $("input[name='goal']:checked").value,
      longStudy: $("#long-study").checked
    };
  }

  function classify(lineRank, candidateRank) {
    if (!finite(lineRank) || !finite(candidateRank)) return null;
    const delta = Number(lineRank) - Number(candidateRank);
    if (delta < -5000) return null;
    if (delta < -900) return "冲";
    if (delta <= 2200) return "稳";
    return "保";
  }

  function classifyScore(lineScore, candidateScore) {
    if (!finite(lineScore)) return "参考";
    const delta = Number(lineScore) - Number(candidateScore);
    if (delta > 28) return null;
    if (delta > 5) return "冲";
    if (delta >= -16) return "稳";
    return "保";
  }

  function majorKeyFromName(name) {
    const rules = [
      [/软件/, "software"], [/计算机|智能科学/, "cs"], [/人工智能/, "ai"], [/数据科学|大数据|统计/, "data"], [/网络空间|信息安全|密码/, "cyber"],
      [/集成电路|微电子|半导体/, "chip"], [/电气/, "electrical"], [/电子|通信|信息工程/, "electronic"], [/自动化|机器人工程/, "automation"],
      [/车辆|汽车|交通运输/, "vehicle"], [/机械|智能制造/, "mechanical"], [/能源|储能|动力工程/, "energy"], [/数学/, "math"], [/物理/, "physics"],
      [/口腔/, "stomatology"], [/临床医学/, "clinical"], [/法学/, "law"], [/会计|审计|财务管理/, "accounting"], [/金融/, "finance"],
      [/生物/, "biology"], [/化学|化工/, "chemistry"], [/环境/, "environment"], [/土木|建筑工程/, "civil"], [/新闻|传播/, "journalism"],
      [/工商管理|市场营销|旅游管理/, "business"], [/英语|日语|德语|法语|外国语言/, "language"], [/纺织/, "textile"]
    ];
    return rules.find(([pattern]) => pattern.test(name))?.[1] || null;
  }

  function majorFromName(name, profile) {
    const key = majorKeyFromName(name);
    const base = key && window.MAJOR_CATALOG[key];
    const major = base ? { key, ...base } : {
      key: `api-${name}`, name, field: "其他", level: "条件", score: 62, color: "#68777b", fit: [],
      outlook: "结合课程、学校平台、实习和具体岗位判断，不能只看专业名称。", study: "以具体培养方案为准。", aiRisk: "需结合岗位任务判断。"
    };
    return { ...major, fitScore: rankMajorObject(major, profile) };
  }

  function rankMajorObject(major, profile) {
    let score = major.score || 60;
    if ((major.fit || []).includes(profile.goal)) score += 16;
    if (profile.goal === "teacher" && major.field !== "师范教育") score -= 22;
    if (profile.goal === "medicine" && major.field !== "医学健康") score -= 18;
    if (!profile.longStudy && /读研|硕博|长期培养|长学制/.test(major.study || "")) score -= 14;
    if (major.level === "高风险") score -= 18;
    return score;
  }

  function excludedMajor(name) {
    return /体育|运动训练|艺术|音乐|舞蹈|美术|播音|表演|戏剧|书法/.test(name || "");
  }

  function requirementMatches(item, profile) {
    if (item.subject !== profile.category) return false;
    if (item.requirement.includes("化学") && !profile.subjects.includes("化学")) return false;
    if (item.requirement.includes("生物") && !profile.subjects.includes("生物")) return false;
    if (item.requirement.includes("政治") && !profile.subjects.includes("思想政治")) return false;
    if (item.requirement.includes("地理") && !profile.subjects.includes("地理")) return false;
    return true;
  }

  function buildLocalResults(profile) {
    if (profile.province !== "湖北") return [];
    return window.ADMISSIONS_HUBEI
      .filter(item => profile.provinces.includes(item.province) && requirementMatches(item, profile))
      .map(item => {
        const risk = classify(item.rank, profile.rank) || classifyScore(item.score, profile.score);
        if (!risk) return null;
        const school = schoolInfo(item.name);
        const majors = item.majors.filter(key => window.MAJOR_CATALOG[key]).map(key => {
          const major = { key, ...window.MAJOR_CATALOG[key] };
          return { ...major, fitScore: rankMajorObject(major, profile) };
        }).sort((a, b) => b.fitScore - a.fitScore);
        const goalBoost = majors.some(major => major.fit.includes(profile.goal)) ? 12 : 0;
        return {
          ...item, nature: school?.nature || "公办", risk, delta: finite(profile.rank) ? item.rank - profile.rank : null,
          majors, fitScore: item.strength + goalBoost, dataYear: 2025, dataKind: "湖北官方投档样本"
        };
      }).filter(Boolean);
  }

  async function metaBatches(province) {
    const key = `batch|${province}`;
    if (state.metaCache.has(key)) return state.metaCache.get(key);
    const batches = await apiPost("/api/v1/meta/batches", { province, year: 2025, source: "plans" });
    state.metaCache.set(key, batches || []);
    return batches || [];
  }

  function chooseBatch(batches, mode) {
    const preferred = mode === "traditional"
      ? ["本科一批", "本科二批", "二本", "本科批"]
      : ["本科批", "普通类一段", "本科一段", "本科A批", "本科一批", "本科二批"];
    return preferred.find(batch => batches.includes(batch)) || batches.find(batch => /本科|普通类一段/.test(batch) && !/提前|专项|艺术|体育/.test(batch));
  }

  function apiTier(item) {
    if (["1", "985", "true"].includes(String(item.f985).toLowerCase())) return "985";
    if (["1", "211", "true"].includes(String(item.f211).toLowerCase()) || item.dual_class_name) return "211";
    return item.nature_name === "民办" ? "private" : "public";
  }

  function transformSmartItem(item, risk, profile) {
    const school = schoolInfo(item.schoolName);
    if (!school || !profile.provinces.includes(school.province)) return null;
    const rawMajors = (item.zyList || []).filter(major => !excludedMajor(major.zyName));
    if (!rawMajors.length) return null;
    const majors = rawMajors.map(major => majorFromName(major.zyName, profile)).sort((a, b) => b.fitScore - a.fitScore);
    const scores = rawMajors.map(major => Number(major.min)).filter(Number.isFinite);
    const ranks = rawMajors.map(major => Number(major.min_section)).filter(value => Number.isFinite(value) && value > 0);
    const lineScore = scores.length ? Math.min(...scores) : null;
    const lineRank = ranks.length ? Math.max(...ranks) : null;
    const effectiveRisk = risk || classify(lineRank, profile.rank) || classifyScore(lineScore, profile.score) || "参考";
    const goalBoost = majors.some(major => (major.fit || []).includes(profile.goal)) ? 12 : 0;
    return {
      id: `open-${item.sid}-${item.sg_name || "group"}-${effectiveRisk}`, name: item.schoolName, province: school.province, city: school.city,
      tier: apiTier(item), nature: item.nature_name || school.nature, subject: profile.category,
      requirement: `${profile.subjects.join("+")}（接口已按选科筛选）`, score: lineScore, rank: lineRank,
      group: item.sg_name || "普通类专业", majors, risk: effectiveRisk,
      delta: finite(lineRank) && finite(profile.rank) ? lineRank - profile.rank : null,
      note: "根据公开历史录取数据生成；专业组、招生人数和选科要求须以2026招生计划复核。",
      strength: lineRank ? 84 : 70, fitScore: 78 + goalBoost, dataYear: 2025, dataKind: "公开聚合历史投档数据"
    };
  }

  async function fetchSmartResults(profile) {
    const batches = await metaBatches(profile.province);
    const batch = chooseBatch(batches, profile.mode);
    if (!batch || profile.rankMethod === "score") return [];
    const data = await apiPost("/api/v1/volunteer/smart-match", {
      province: profile.province,
      batch,
      rank_year: 2025,
      rank: profile.rank || 0,
      score: profile.score,
      is_key: 0,
      token: "",
      type: 1,
      subject: profile.category,
      xuanke: profile.subjects.join(",")
    });
    const groups = data.zyb_data?.zybData || {};
    const map = { chong: "冲", wen: "稳", bao: "保" };
    return Object.entries(map).flatMap(([key, risk]) => (groups[key] || []).map(item => transformSmartItem(item, risk, profile))).filter(Boolean);
  }

  function catalogFallback(profile, reason) {
    const tierByName = new Map((window.ADMISSIONS_HUBEI || []).map(item => [item.name, item.tier]));
    return (window.SCHOOL_CATALOG || [])
      .filter(school => profile.provinces.includes(school.province))
      .sort((a, b) => {
        const ta = tierByName.get(a.name) === "985" ? 0 : tierByName.get(a.name) === "211" ? 1 : a.nature === "公办" ? 2 : 3;
        const tb = tierByName.get(b.name) === "985" ? 0 : tierByName.get(b.name) === "211" ? 1 : b.nature === "公办" ? 2 : 3;
        return ta - tb || a.name.localeCompare(b.name, "zh-CN");
      })
      .slice(0, 40)
      .map((school, index) => ({
        id: `catalog-${school.id}`, name: school.name, province: school.province, city: school.city,
        tier: tierByName.get(school.name) || (school.nature === "民办" ? "private" : "public"), nature: school.nature,
        subject: profile.category, requirement: "请核对2026招生计划", score: null, rank: null, group: "普通本科院校目录",
        majors: [], risk: "参考", delta: null, note: reason, strength: 45, fitScore: 45 - index / 10,
        dataYear: 2025, dataKind: "院校目录参考"
      }));
  }

  async function fetchRecommendations(profile) {
    const local = buildLocalResults(profile);
    let remote = [];
    let remoteError = null;
    try {
      remote = await fetchSmartResults(profile);
    } catch (error) {
      remoteError = error;
    }
    const seen = new Set();
    const merged = [...remote, ...local].filter(item => {
      const key = `${normalizeSchoolName(item.name)}|${item.group}|${item.score || "none"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (merged.length) return merged;
    return catalogFallback(profile, remoteError ? `历史投档接口暂不可用：${remoteError.message}。当前仅展示教育部本科院校目录，不代表录取概率。` : "所选地区暂无匹配的历史投档记录，当前仅展示教育部本科院校目录，不代表录取概率。");
  }

  function profileVerdict(profile, results) {
    const counts = { "冲": 0, "稳": 0, "保": 0 };
    results.forEach(item => { if (counts[item.risk] != null) counts[item.risk]++; });
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
    const rankText = finite(profile.rank) ? `${profile.rankYear}累计第${number(profile.rank)}名` : "2025分数参考";
    $("#candidate-score").textContent = profile.score;
    $("#candidate-summary").textContent = `${profile.province} · ${profile.subjects.join("+")} · ${rankText} · ${goalNames[profile.goal]}`;
    $("#verdict-text").textContent = headline;
    $("#verdict-quote").textContent = quote;
    $("#verdict-tags").innerHTML = `<span>${profile.rankYear}${profile.rankYear === 2026 ? "位次数据" : "历史数据参考"}</span><span>${profile.provinces.join("、")}</span><span>投档数据：2025及以前</span>`;
    $("#reach-count").textContent = counts["冲"];
    $("#match-count").textContent = counts["稳"];
    $("#safe-count").textContent = counts["保"];
    $("#total-count").textContent = results.length;
  }

  function tierLabel(item) {
    if (item.tier === "985" || item.tier === "211") return tierNames[item.tier];
    return item.nature === "民办" ? "民办本科" : "普通公办本科";
  }
  function riskColor(risk) { return risk === "冲" ? "#eb6b3a" : risk === "稳" ? "#d59b2e" : risk === "保" ? "#2c7a67" : "#68777b"; }

  function majorPill(major) {
    return `<span class="major-pill" style="--major-color:${major.color}" title="${escapeHtml(major.outlook)}"><b></b>${escapeHtml(major.name)} · ${major.level}</span>`;
  }

  function cardSummary(item, profile) {
    if (item.risk === "参考") return "当前只有院校目录或不完整历史数据，不能据此判断录取概率。";
    if (profile.goal === "teacher" && item.majors.some(m => m.field === "师范教育")) return "教师路线匹配；公费师范、优师专项与普通批必须分开核验。";
    if (item.risk === "冲") return "可以冲，但别把它当稳妥项；专业组和调剂去向必须能接受。";
    if (item.risk === "稳") return "历史位置基本匹配，热门专业仍要在学校线之上再留位次。";
    return "位次有安全边际，适合承担保底任务；保学校也要保专业质量。";
  }

  function renderCard(item, profile) {
    const topMajors = item.majors.slice(0, 4);
    const detailMajors = item.majors.slice(0, 2);
    const lineText = finite(item.score) ? `${item.score}分${finite(item.rank) ? ` / ${number(item.rank)}名` : ""}` : "暂无可核验投档线";
    let deltaText = item.dataKind;
    if (finite(item.delta)) deltaText = item.delta >= 0 ? `你领先历史线约 ${number(item.delta)} 位` : `你落后历史线约 ${number(Math.abs(item.delta))} 位`;
    return `
      <article class="college-card" data-id="${escapeHtml(item.id)}" style="--risk-color:${riskColor(item.risk)}">
        <div class="college-top">
          <div>
            <div class="college-title-line"><h4>${escapeHtml(item.name)}</h4><span class="tier-tag">${tierLabel(item)}</span><span class="risk-tag">${item.risk}</span></div>
            <p class="college-meta">${item.province} · ${item.city}　|　${escapeHtml(item.group)}　|　${escapeHtml(item.requirement)}</p>
          </div>
          <div class="rank-box"><small>${item.dataYear} · ${escapeHtml(item.dataKind)}</small><strong>${lineText}</strong><span class="rank-delta">${deltaText}</span></div>
        </div>
        <div class="college-rule"><span>位次数据：${profile.rankYear}${profile.rankMethod === "score" ? "分数参考" : "一分一段"}</span><span>投档数据：${item.dataYear}</span><span>类型：${item.dataKind}</span></div>
        <div class="major-row">${topMajors.map(majorPill).join("") || "<span class='major-pill'>请打开2026招生计划核对专业</span>"}</div>
        <div class="college-bottom"><p>${cardSummary(item, profile)}</p><button class="detail-button" type="button">展开判断 ↓</button></div>
        <div class="college-detail">
          <div class="detail-block"><strong>数据与专业组</strong><p>${escapeHtml(item.note)}</p></div>
          <div class="detail-block"><strong>优先专业怎么选</strong><p>${detailMajors.map(m => `${m.name}：${m.outlook}`).join(" ") || "当前暂无专业级数据，请查看2026招生计划。"}</p></div>
          <div class="detail-block"><strong>培养周期</strong><p>${detailMajors.map(m => `${m.name}—${m.study}`).join(" ") || "以高校培养方案为准。"}</p></div>
          <div class="detail-block"><strong>AI与行业风险</strong><p>${detailMajors.map(m => `${m.name}—${m.aiRisk}`).join(" ") || "需结合具体专业与岗位判断。"}</p></div>
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
    if (state.sort === "score") list.sort((a, b) => (finite(b.score) ? b.score : -1) - (finite(a.score) ? a.score : -1) || a.name.localeCompare(b.name, "zh-CN"));
    else if (state.sort === "rank") list.sort((a, b) => (finite(a.rank) ? a.rank : Infinity) - (finite(b.rank) ? b.rank : Infinity));
    else if (state.sort === "employment") list.sort((a, b) => (b.majors[0]?.fitScore || 0) - (a.majors[0]?.fitScore || 0));
    else list.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || b.fitScore - a.fitScore);
    return list;
  }

  function renderList() {
    const list = filteredResults();
    $("#visible-count").textContent = `当前显示 ${list.length} 条建议`;
    $("#college-list").innerHTML = list.map(item => renderCard(item, state.profile)).join("");
    $("#empty-state").classList.toggle("hidden", list.length > 0);
    if (!list.length) {
      $("#empty-title").textContent = "当前筛选没有匹配结果";
      $("#empty-message").textContent = "请切换冲稳保、院校层次或专业方向筛选；目标省份不会被系统自动扩大。";
    }
    $$(".detail-button").forEach(button => button.addEventListener("click", () => {
      const card = button.closest(".college-card");
      const open = card.classList.toggle("open");
      button.textContent = open ? "收起判断 ↑" : "展开判断 ↓";
    }));
  }

  async function runFinder(event) {
    event.preventDefault();
    await updateRankResult();
    if (!validate()) return;
    const profile = getProfile();
    const button = $("#finder-form .primary-button");
    button.classList.add("loading");
    button.disabled = true;
    button.querySelector("span").textContent = "正在生成建议";
    try {
      const results = await fetchRecommendations(profile);
      state.profile = profile;
      state.results = results;
      state.risk = state.tier = state.major = "all";
      state.sort = "score";
      $$("#risk-filter button").forEach(tab => tab.classList.toggle("active", tab.dataset.value === "all"));
      $("#tier-filter").value = $("#major-filter").value = "all";
      $("#sort-filter").value = "score";
      renderVerdict(profile, results);
      renderList();
      $("#results").classList.remove("hidden");
      setTimeout(() => $("#results").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (error) {
      $("#province-error").textContent = `建议生成失败：${error.message}`;
    } finally {
      button.classList.remove("loading");
      button.disabled = false;
      button.querySelector("span").textContent = "开始筛选志愿";
    }
  }

  function bindEvents() {
    $("#finder-form").addEventListener("submit", runFinder);
    $("#candidate-province").addEventListener("change", renderSubjectControls);
    $("#subject").addEventListener("change", () => scheduleRankUpdate(0));
    $("#score").addEventListener("input", () => scheduleRankUpdate(280));
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
