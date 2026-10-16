import {themes,summaries,love as loveMessages,work as workMessages,money as moneyMessages,health as healthMessages,colors as luckyColors,items as luckyItems,actions as luckyActions,cautions,closings} from "./korean-templates.js";
const ranks=[{value:"최고의 흐름",weight:12},{value:"좋은 흐름",weight:24},{value:"잔잔한 행운",weight:24},{value:"차분한 하루",weight:25},{value:"천천히 나아가는 날",weight:15}];
export function generateFortune(fortuneDate) {
  const rank = weightedPick(ranks);
  const scores = createScores(rank);

  return `🔮 ${formatDate(fortuneDate)} 오늘의 운세 (한국 시간)

【${rank}】
${pick(themes)}

${pick(summaries)}

――――――――――
🌟 오늘의 운세 점수
종합운: ${scoreBar(scores.total)} ${scores.total}점
연애운: ${scoreBar(scores.love)} ${scores.love}점
직장운: ${scoreBar(scores.work)} ${scores.work}점
금전운: ${scoreBar(scores.money)} ${scores.money}점
건강운: ${scoreBar(scores.health)} ${scores.health}점

――――――――――
💗 연애운
${pick(loveMessages)}

💼 직장운
${pick(workMessages)}

💰 금전운
${pick(moneyMessages)}

🌿 건강운
${pick(healthMessages)}

――――――――――
🎨 행운의 색
${pick(luckyColors)}

👜 행운의 아이템
${pick(luckyItems)}

🔢 행운의 숫자
${randomInt(1, 99)}

🕒 행운의 시간
${pickLuckyTime()}

✨ 오늘의 행운 행동
${pick(luckyActions)}

⚠️ 오늘의 조언
${pick(cautions)}

――――――――――
${pick(closings)}`;
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function createScores(rank) {
  const ranges = {
    "최고의 흐름": [82, 98],
    "좋은 흐름": [72, 90],
    "잔잔한 행운": [63, 84],
    "차분한 하루": [58, 78],
    "천천히 나아가는 날": [50, 72]
  };

  const [min, max] = ranges[rank] ?? [55, 80];

  return {
    total: randomInt(min, max),
    love: randomInt(Math.max(45, min - 8), max),
    work: randomInt(Math.max(45, min - 8), max),
    money: randomInt(Math.max(45, min - 8), max),
    health: randomInt(Math.max(45, min - 8), max)
  };
}

function scoreBar(score) {
  if (score >= 90) return "★★★★★";
  if (score >= 80) return "★★★★☆";
  if (score >= 70) return "★★★☆☆";
  if (score >= 60) return "★★☆☆☆";
  return "★☆☆☆☆";
}

function pickLuckyTime() {
  return pick([
    "7:00～9:00", "9:00～11:00", "11:00～13:00",
    "13:00～15:00", "15:00～17:00", "17:00～19:00",
    "19:00～21:00", "21:00～23:00"
  ]);
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let value = Math.random() * total;

  for (const item of items) {
    value -= item.weight;
    if (value <= 0) return item.value;
  }

  return items.at(-1).value;
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

