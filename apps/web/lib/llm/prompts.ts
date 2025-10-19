import type { TravelPreferences } from "@core/index";

export function buildItineraryPrompt(preferences: TravelPreferences): string {
  const { destination, days, budgetCNY, companions, interests } = preferences;
  const interestsText = interests.length > 0 ? interests.join("、") : "综合体验";
  return `你是一名专业旅行规划师，请根据以下参数输出 JSON，字段需严格使用英文 key：
目的地: ${destination}
行程天数: ${days}
总预算: ${budgetCNY} 人民币
同行人数: ${companions}
兴趣: ${interestsText}

JSON 数据结构需包含：
- overview: 对行程的整体概览。
- estimatedTotal: 总预算估算（数字）。
- dayPlans: 数组，每一天必须具备以下字段：
  - day: 天数编号（从 1 开始）。
  - summary: 当日概述。
  - highlights: 当日亮点列表。
  - estimatedCost: 当日预计花费。
  - meals: 餐饮建议列表（可选，用于描述整体餐饮安排）。
  - transportation: 当日交通安排数组，每个元素需包含 mode（交通方式），可选 origin、destination、departureTime、arrivalTime、duration、detail、costEstimate。
  - accommodation: 当日住宿安排对象，包含 name，建议附上 address、checkIn、checkOut、costEstimate、notes 等信息。
  - restaurants: 餐饮推荐数组，每个元素需包含 name，辅以 cuisine、mustTry、address、reservation（布尔值）、budgetPerPerson、time 等细节。
  - locations: 当日要打卡的景点/活动节点，按照游览顺序排列，必须是数组，每个元素包含 name（地点名称），可选 latitude、longitude（十进制度数）、address。

请确保 dayPlans 中 transportation、restaurants 至少返回空数组，accommodation 至少返回 null 或包含 name 的对象；locations 数组保持合理顺序并尽量提供真实坐标。只返回符合该 JSON 结构的数据，无需额外描述。`;
}
