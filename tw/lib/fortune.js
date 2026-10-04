const ranks = [
  { value: "大吉", weight: 12 },
  { value: "中吉", weight: 24 },
  { value: "小吉", weight: 24 },
  { value: "吉", weight: 25 },
  { value: "末吉", weight: 15 }
];

const themes = [
  "今天將迎來新的契機",
  "小小的選擇，也能改變未來",
  "與人的連結，將為你帶來好運",
  "相信直覺，就能找到方向",
  "用心付出，將獲得肯定",
  "放慢腳步、調整步調，事情就會好轉",
  "試試不同的做法，機會就在其中",
  "轉換心情，運氣也會跟著變好"
];

const summaries = [
  "今天只要把眼前的事情一件件整理好，就能提升運勢。與其急著下結論，不如專注於每一步，用心慢慢來。",
  "你不經意的一句話或一個舉動，今天都可能為身邊的人帶來正面的影響。自在地做自己，好事就會自然發生。",
  "有些猶豫也沒關係。結合直覺與實際的判斷，你就能做出讓自己安心的選擇。",
  "小小的機會就在身邊。試著留意那些平常容易忽略的事情，或許會有意外的發現。",
  "今天只要稍微主動一點，就能為自己帶來好運。不必等到一切完美，先踏出第一步最重要。",
  "別人的一句話，或偶然發生的小事，都可能藏著今天的提示。讓你在意的事情，不妨先記下來。"
];

const loveMessages = [
  "真誠的話語能拉近彼此的距離。即使只傳一則簡短的訊息，也能讓對方感受到你的心意。",
  "今天適合當個好聽眾。用心聆聽對方的想法，有機會讓你們的關係更親近。",
  "不必急著找到答案。珍惜自然相處的節奏，關係就會朝好的方向發展。",
  "一個微笑、一句輕鬆的問候，都能創造機會。別想得太沉重，保持開朗的心情吧。",
  "把感謝說出口，愛情運就會提升。別忘了對身邊的人說聲「謝謝」。",
  "今天你的個性就是最迷人的地方。保持自己的步調，不必過度迎合對方。"
];

const workMessages = [
  "仔細確認細節，有助於取得好成果。比起求快，注重準確度更能獲得肯定。",
  "今天適合提出想法或找人討論。別一個人扛下所有事情，及早分享能讓進度更順利。",
  "今天容易進入專注的狀態。即使時間不長，只要用心投入，也能完成比預期更多的事。",
  "把一直拖著的工作處理好，心情也會跟著輕鬆起來。",
  "今天容易冒出新的點子。就算暫時用不上，先記下來，之後也許會派上用場。",
  "與他人合作是今天的關鍵。一句體貼的關心，就能提升你的工作運。"
];

const moneyMessages = [
  "留意衝動購物。不過，將金錢用在學習、健康等對未來有幫助的事情上，會是個不錯的方向。",
  "小小的節省也能帶來滿足感。仔細分辨哪些是必需品，哪些可以晚點再買。",
  "今天更容易看出事物真正的價值。做決定時，不妨問問自己是否打從心裡認同。",
  "別只因為便宜就買下來。想想是否能長久使用、好好珍惜，更容易買到合適的東西。",
  "今天容易遇到小小的好運。帶著感謝的心使用金錢，美好的機會也會慢慢靠近。",
  "送一份小禮物，或用金錢表達感謝，都能讓心裡更富足。"
];

const healthMessages = [
  "留意肩膀和眼睛的疲勞。適時休息一下，也能讓心情與運勢重新回到舒服的狀態。",
  "提升睡眠品質，是今天的開運重點。今晚不妨早一點休息。",
  "讓身體暖和一點，心情也會更穩定。試試溫熱的飲品，或洗個舒服的熱水澡。",
  "輕鬆散步或伸展一下，能讓好運動起來。依照自己的狀況，適度活動身體吧。",
  "深呼吸有助於轉換心情。感到焦急時，先停下來，給自己一點空間。",
  "別等到太累才休息。即使只有短短幾分鐘，也要留點時間恢復精神。"
];

const luckyColors = [
  "薰衣草紫", "海軍藍", "金色", "白色",
  "土耳其藍", "玫瑰粉", "翡翠綠",
  "銀色", "橘色", "酒紅色"
];

const luckyItems = [
  "手帕", "溫熱的飲品", "喜歡的筆",
  "小筆記本", "帶有香氣的小物", "手錶",
  "白色小物", "手機殼", "書", "耳機"
];

const luckyActions = [
  "在早上整理今天的行程",
  "稍微整理桌面或包包",
  "傳一則簡短的訊息給在意的人",
  "完成一件一直拖著沒做的事",
  "比平常更用心地向人問好",
  "留五分鐘給自己，好好深呼吸",
  "向身邊的人表達感謝",
  "晚上寫下一件今天發生的好事"
];

const cautions = [
  "想太多可能會錯過機會。猶豫時，不妨先做一個小小的嘗試。",
  "別過度解讀對方的反應。許多事情只要問清楚，就能找到答案。",
  "臨時的行程變動，可能會讓你有些心煩。安排時留點彈性，就能更安心。",
  "太追求完美容易感到疲累。今天就算只有七十分，也是一種進步。",
  "有時候語氣可能不自覺變得強硬。傳訊息或開口前，先稍微確認一下。",
  "別勉強自己撐著疲憊。好好休息，也是今天重要的開運行動。"
];

const closings = [
  "今天的你，有著靜靜吸引好運的力量。",
  "小小的一步，也許會帶來比想像中更大的改變。",
  "別著急，珍惜自己的步調，一切都會慢慢變好。",
  "今天整理好的事情，將成為明天的機會。",
  "忠於自己的選擇，會帶你走向更美好的未來。",
  "越能看見眼前的小幸福，運勢就越會溫柔地向上提升。"
];

export function generateFortune(fortuneDate) {
  const rank = weightedPick(ranks);
  const scores = createScores(rank);

  return `🔮 ${formatDate(fortuneDate)} 今日運勢（台灣時間）

【${rank}】
${pick(themes)}

${pick(summaries)}

――――――――――
🌟 今日運勢評分
整體運：${scoreBar(scores.total)} ${scores.total}分
愛情運：${scoreBar(scores.love)} ${scores.love}分
工作運：${scoreBar(scores.work)} ${scores.work}分
財運　：${scoreBar(scores.money)} ${scores.money}分
健康運：${scoreBar(scores.health)} ${scores.health}分

――――――――――
💗 愛情運
${pick(loveMessages)}

💼 工作運
${pick(workMessages)}

💰 財運
${pick(moneyMessages)}

🌿 健康運
${pick(healthMessages)}

――――――――――
🎨 幸運色
${pick(luckyColors)}

👜 幸運物品
${pick(luckyItems)}

🔢 幸運數字
${randomInt(1, 99)}

🕒 幸運時段
${pickLuckyTime()}

✨ 今日開運行動
${pick(luckyActions)}

⚠️ 今日提醒
${pick(cautions)}

――――――――――
${pick(closings)}`;
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function createScores(rank) {
  const ranges = {
    大吉: [82, 98],
    中吉: [72, 90],
    小吉: [63, 84],
    吉: [58, 78],
    末吉: [50, 72]
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
