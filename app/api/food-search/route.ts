type JsonRecord = Record<string, unknown>;

const text = (record: JsonRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};

const number = (record: JsonRecord, ...keys: string[]) => {
  const value = text(record, ...keys).replaceAll(",", "").replace(/[^\d.-]/g, "");
  return Number.isFinite(Number(value)) ? Number(value) : 0;
};

const parseBasis = (record: JsonRecord) => {
  const label = text(record, "NUTRI_AMOUNT_SERVING", "SERVING_SIZE", "nutriAmountServing", "servingSize") || "100g";
  const match = label.match(/([\d.]+)\s*(kg|g|개|인분|ml|mL)/i);
  if (!match) return { baseAmount: 100, unit: "g" as const };
  const rawUnit = match[2].toLowerCase();
  return {
    baseAmount: Math.max(0.1, Number(match[1]) || 100),
    unit: rawUnit === "kg" ? "kg" as const : rawUnit === "개" ? "개" as const : rawUnit === "인분" ? "인분" as const : "g" as const,
  };
};

const itemsFrom = (payload: unknown): JsonRecord[] => {
  const root = payload as JsonRecord;
  const body = (root?.body ?? (root?.response as JsonRecord)?.body) as JsonRecord | undefined;
  const items = body?.items ?? root?.items;
  if (Array.isArray(items)) return items as JsonRecord[];
  if (items && typeof items === "object") {
    const item = (items as JsonRecord).item;
    return Array.isArray(item) ? item as JsonRecord[] : item && typeof item === "object" ? [item as JsonRecord] : [];
  }
  return [];
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const serviceKey = process.env.MFDS_API_KEY;
  if (!serviceKey) return Response.json({ configured: false, items: [] });
  if (query.length < 2) return Response.json({ configured: true, items: [] });

  const params = new URLSearchParams({
    serviceKey,
    pageNo: "1",
    numOfRows: "20",
    type: "json",
    FOOD_NM_KR: query,
  });
  const response = await fetch(`https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02?${params}`, { cache: "no-store" });
  if (!response.ok) return Response.json({ configured: true, items: [] }, { status: 502 });
  const payload = await response.json() as unknown;
  const items = itemsFrom(payload).map((record) => {
    const basis = parseBasis(record);
    return {
      code: text(record, "FOOD_CD", "foodCd", "foodCode"),
      name: text(record, "FOOD_NM_KR", "DESC_KOR", "foodNmKr", "foodNm"),
      ...basis,
      calories: number(record, "AMT_NUM1", "ENERC", "NUTR_CONT1", "enerc", "energy"),
      carbs: number(record, "AMT_NUM2", "CHOCDF", "NUTR_CONT2", "chocdf", "carbohydrate"),
      protein: number(record, "AMT_NUM3", "PROT", "NUTR_CONT3", "prot", "protein"),
      fat: number(record, "AMT_NUM4", "FATCE", "FAT", "NUTR_CONT4", "fatce", "fat"),
      sugar: number(record, "AMT_NUM5", "SUGAR", "NUTR_CONT5", "sugar"),
      fiber: number(record, "FIBTG", "fiber", "dietaryFiber"),
      maker: text(record, "MAKER_NM", "MAKER_NAME", "makerNm", "makerName"),
    };
  }).filter((item) => item.name);

  return Response.json({ configured: true, items });
}
