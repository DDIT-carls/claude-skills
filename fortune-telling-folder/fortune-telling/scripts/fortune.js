#!/usr/bin/env node
/**
 * fortune.js — 基于 lunar-javascript 的命理数据计算器
 *
 * 本脚本只负责“算数”：把公历生日/查询日期转换成真实的历法与命理数据
 * （农历、干支、八字、五行、十神、星座、生肖、老黄历宜忌、财神/喜神/福神方位、
 * 冲煞、纳音、星宿、彭祖百忌等）。它不生成任何“运势文案”或占卜结论——
 * 那部分请 Claude 在拿到这里的结构化 JSON 之后，结合 references/ 里的
 * 解读指南自己组织语言输出。
 *
 * 用法：
 *   node fortune.js natal --date 1995-08-17 --time 14:30 [--gender male|female]
 *   node fortune.js daily --date 2026-08-17 [--birth 1995-08-17 --time 14:30]
 *   node fortune.js match --date1 1995-08-17 --time1 14:30 --date2 1996-02-03 --time2 08:00
 *
 * 所有命令输出 JSON 到 stdout。
 */

const path = require('path');
const { Solar, Lunar } = require(path.join(__dirname, 'lunar.js'));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

function toSolar(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let hh = 0, mm = 0, ss = 0;
  if (timeStr) {
    const parts = timeStr.split(':').map(Number);
    hh = parts[0] || 0; mm = parts[1] || 0; ss = parts[2] || 0;
  }
  return Solar.fromYmdHms(y, m, d, hh, mm, ss);
}

// ---- 干支五行（用于生克判断） ----
const WUXING_SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }; // A生B
const WUXING_KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };   // A克B

function wuxingRelation(a, b) {
  if (a === b) return '比和';
  if (WUXING_SHENG[a] === b) return `${a}生${b}`;
  if (WUXING_SHENG[b] === a) return `${b}生${a}`;
  if (WUXING_KE[a] === b) return `${a}克${b}`;
  if (WUXING_KE[b] === a) return `${b}克${a}`;
  return '未知';
}

// ---- 生肖关系（传统命理常用表，lunar-javascript 未内置，这里按标准口诀补充） ----
const SHENGXIAO_LIST = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
// 六合：子丑合、寅亥合、卯戌合、辰酉合、巳申合、午未合
const LIUHE_PAIRS = [['鼠', '牛'], ['虎', '猪'], ['兔', '狗'], ['龙', '鸡'], ['蛇', '猴'], ['马', '羊']];
// 三合局：申子辰合水、巳酉丑合金、寅午戌合火、亥卯未合木
const SANHE_GROUPS = [
  ['猴', '鼠', '龙'], ['蛇', '鸡', '牛'], ['虎', '马', '狗'], ['猪', '兔', '羊']
];
// 六冲：子午冲、丑未冲、寅申冲、卯酉冲、辰戌冲、巳亥冲
const LIUCHONG_PAIRS = [['鼠', '马'], ['牛', '羊'], ['虎', '猴'], ['兔', '鸡'], ['龙', '狗'], ['蛇', '猪']];
// 相害：子未害、丑午害、寅巳害、卯辰害、申亥害、酉戌害
const XIANGHAI_PAIRS = [['鼠', '羊'], ['牛', '马'], ['虎', '蛇'], ['兔', '龙'], ['猴', '猪'], ['鸡', '狗']];

function shengxiaoRelation(sx1, sx2) {
  if (sx1 === sx2) return '同属相（本命）';
  const inPairs = (pairs) => pairs.some(([x, y]) => (x === sx1 && y === sx2) || (x === sx2 && y === sx1));
  if (inPairs(LIUHE_PAIRS)) return '六合（传统认为相配、互补）';
  if (SANHE_GROUPS.some(g => g.includes(sx1) && g.includes(sx2))) return '三合（传统认为相合、助力大）';
  if (inPairs(LIUCHONG_PAIRS)) return '相冲（传统认为易有摩擦，需多包容）';
  if (inPairs(XIANGHAI_PAIRS)) return '相害（传统认为需多沟通磨合）';
  return '平和（无特殊生肖关系，看其他因素）';
}

// ---- 西方星座配对（元素分组，通用大众占星知识） ----
const XINGZUO_ELEMENT = {
  白羊: '火', 狮子: '火', 射手: '火',
  金牛: '土', 处女: '土', 摩羯: '土',
  双子: '风', 天秤: '风', 水瓶: '风',
  巨蟹: '水', 天蝎: '水', 双鱼: '水',
};
const ELEMENT_AFFINITY = {
  火: { 火: '同属火象，热情直接，容易一拍即合，也容易一起冲动。', 土: '火土组合需要磨合：一个求变一个求稳。', 风: '火风相生，风助火势，通常很来电、很有话聊。', 水: '水火本相克，激情与敏感容易互相消耗，需要耐心。' },
  土: { 火: '土火组合需要磨合：一个求稳一个求变。', 土: '同属土象，务实稳定，安全感强，但也可能都比较固执。', 风: '土风组合需要时间适应：一个重实际一个重想法。', 水: '水土相生，滋养型搭配，通常很互补、很稳。' },
  风: { 火: '风火相生，通常很来电、很有话聊。', 土: '风土组合需要时间适应：一个重想法一个重实际。', 风: '同属风象，思维活跃、沟通顺畅，但也可能都不够落地。', 水: '风水组合需要磨合：一个理性一个感性。' },
  水: { 火: '水火本相克，敏感与激情容易互相消耗，需要耐心。', 土: '水土相生，滋养型搭配，通常很互补、很稳。', 风: '水风组合需要磨合：一个感性一个理性。', 水: '同属水象，情感细腻、心有灵犀，但也容易一起emo。' },
};

function xingzuoRelation(xz1, xz2) {
  const e1 = XINGZUO_ELEMENT[xz1], e2 = XINGZUO_ELEMENT[xz2];
  if (!e1 || !e2) return null;
  return { element1: e1, element2: e2, note: ELEMENT_AFFINITY[e1][e2] };
}

function baziProfile(solar) {
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();
  return {
    solarDate: solar.toYmdHms(),
    weekday: solar.getWeekInChinese() + '曜日',
    lunarDate: lunar.toString(),
    lunarFullString: lunar.toFullString(),
    xingzuo: solar.getXingZuo(),
    shengxiao: lunar.getYearShengXiao(),
    ganzhiYear: lunar.getYearInGanZhi(),
    bazi: {
      year: ec.getYear(), month: ec.getMonth(), day: ec.getDay(), time: ec.getTime(),
      full: `${ec.getYear()} ${ec.getMonth()} ${ec.getDay()} ${ec.getTime()}`,
    },
    dayMaster: {
      ganzhi: ec.getDay(),
      gan: ec.getDayGan(),
      wuxing: ec.getDayWuXing(),
      note: '日主（日柱天干）代表命主本人，是八字分析的核心参照点。',
    },
    wuxing: {
      year: ec.getYearWuXing(), month: ec.getMonthWuXing(), day: ec.getDayWuXing(), time: ec.getTimeWuXing(),
    },
    naYin: {
      year: ec.getYearNaYin(), month: ec.getMonthNaYin(), day: ec.getDayNaYin(), time: ec.getTimeNaYin(),
    },
    shiShenGan: {
      year: ec.getYearShiShenGan(), month: ec.getMonthShiShenGan(), day: ec.getDayShiShenGan(), time: ec.getTimeShiShenGan(),
    },
    shiShenZhi: {
      year: ec.getYearShiShenZhi() + '', month: ec.getMonthShiShenZhi() + '', day: ec.getDayShiShenZhi() + '', time: ec.getTimeShiShenZhi() + '',
    },
    xiu: { name: lunar.getXiu(), luck: lunar.getXiuLuck() },
    pengZu: { gan: lunar.getPengZuGan(), zhi: lunar.getPengZuZhi() },
  };
}

function almanacOf(solar) {
  const lunar = solar.getLunar();
  return {
    date: solar.toYmd(),
    lunarDate: lunar.toString(),
    ganzhiDay: lunar.getDayInGanZhi(),
    yi: lunar.getDayYi(),
    ji: lunar.getDayJi(),
    chong: lunar.getDayChongDesc(),
    sha: lunar.getDaySha(),
    positions: {
      财神: lunar.getDayPositionCaiDesc(),
      喜神: lunar.getDayPositionXiDesc(),
      福神: lunar.getDayPositionFuDesc(),
      阳贵神: lunar.getDayPositionYangGuiDesc ? lunar.getDayPositionYangGuiDesc() : undefined,
      阴贵神: lunar.getDayPositionYinGuiDesc ? lunar.getDayPositionYinGuiDesc() : undefined,
      胎神: lunar.getDayPositionTai(),
    },
    xiu: { name: lunar.getXiu(), luck: lunar.getXiuLuck() },
    dayWuXing: lunar.getEightChar().getDayWuXing(),
  };
}

function cmdNatal(args) {
  if (!args.date) throw new Error('缺少 --date（格式 YYYY-MM-DD）');
  const solar = toSolar(args.date, args.time);
  const profile = baziProfile(solar);
  profile.gender = args.gender || null;
  console.log(JSON.stringify(profile, null, 2));
}

function cmdDaily(args) {
  const querySolar = args.date ? toSolar(args.date) : Solar.fromDate(new Date());
  const result = { query: almanacOf(querySolar) };
  if (args.birth) {
    const birthSolar = toSolar(args.birth, args.time);
    const natal = baziProfile(birthSolar);
    result.person = natal;
    // 今日日柱五行 与 命主日主五行 的生克关系，作为"今日运势"的命理依据
    // 日主五行取日柱天干对应的五行（wuxing 字符串首字，如"庚辰"->"金土"取"金"）
    result.relationToDayMaster = wuxingRelation(natal.dayMaster.wuxing[0], result.query.dayWuXing[0]);
    result.note = '以上仅列出今日干支五行与命主日主的生克关系作为参考依据，具体运势解读请结合 references/interpretation-guide.md 撰写，不要照搬字面生克结论。';
  }
  console.log(JSON.stringify(result, null, 2));
}

function cmdMatch(args) {
  if (!args.date1 || !args.date2) throw new Error('缺少 --date1 / --date2');
  const solar1 = toSolar(args.date1, args.time1);
  const solar2 = toSolar(args.date2, args.time2);
  const p1 = baziProfile(solar1);
  const p2 = baziProfile(solar2);
  const result = {
    person1: p1,
    person2: p2,
    shengxiaoRelation: shengxiaoRelation(p1.shengxiao, p2.shengxiao),
    xingzuoRelation: xingzuoRelation(p1.xingzuo, p2.xingzuo),
    dayMasterWuxingRelation: wuxingRelation(p1.dayMaster.wuxing[0], p2.dayMaster.wuxing[0]),
    note: '以上为生肖/星座/日主五行的传统关系速查结果，仅供参考素材；请勿把"相冲""相克"直接等同于不合适，命理解读需结合 references/interpretation-guide.md 综合、辩证地表达。',
  };
  console.log(JSON.stringify(result, null, 2));
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);
  try {
    if (cmd === 'natal') return cmdNatal(args);
    if (cmd === 'daily') return cmdDaily(args);
    if (cmd === 'match') return cmdMatch(args);
    console.error('用法: node fortune.js <natal|daily|match> [--参数 值 ...]');
    process.exit(1);
  } catch (e) {
    console.error('计算出错:', e.message);
    process.exit(1);
  }
}

main();
