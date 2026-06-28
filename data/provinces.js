(function () {
  const names = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
    "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆"
  ];
  const threePlusThree = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
  const traditional = new Set(["西藏", "新疆"]);

  window.PROVINCE_CONFIG = Object.fromEntries(names.map(name => {
    const mode = traditional.has(name) ? "traditional" : threePlusThree.has(name) ? "3+3" : "3+1+2";
    return [name, {
      name,
      mode,
      maxScore: name === "上海" ? 660 : name === "海南" ? 900 : 750,
      subjects: mode === "3+3"
        ? (name === "浙江" ? ["物理", "化学", "生物", "思想政治", "历史", "地理", "技术"] : ["物理", "化学", "生物", "思想政治", "历史", "地理"])
        : mode === "3+1+2" ? ["化学", "生物", "思想政治", "地理"] : [],
      rankReady: name === "湖北",
      admissionReady: name === "湖北",
      status: name === "湖北" ? "已接入2026官方位次与2025普通批样本" : "全国界面已开放，官方数据正在核验"
    }];
  }));

  window.ALL_PROVINCES = names;
})();
