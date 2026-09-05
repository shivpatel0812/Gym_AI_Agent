import {
  dayFamilyKey,
  dayFamilyLabel,
  groupDaysByFamily,
  variantCaption,
} from "./dayFamilies";

describe("dayFamilyKey", () => {
  it("collapses A/B and intensity suffixes onto one family", () => {
    expect(dayFamilyKey("Push A")).toBe("push");
    expect(dayFamilyKey("Push B")).toBe("push");
    expect(dayFamilyKey("Pull A")).toBe("pull");
    expect(dayFamilyKey("pull-heavy")).toBe("pull");
    expect(dayFamilyKey("Legs")).toBe("legs");
    expect(dayFamilyKey("Legs Day")).toBe("legs");
  });

  it("does not eat unrelated day names", () => {
    expect(dayFamilyKey("Abs")).toBe("abs");
    expect(dayFamilyKey("Upper Body")).toBe("upper body");
  });
});

describe("groupDaysByFamily", () => {
  it("turns a 5-day PPL into three hub pages", () => {
    const families = groupDaysByFamily([
      { day_name: "Push A", focus: "Heavy" },
      { day_name: "Pull A", focus: "Heavy" },
      { day_name: "Legs", focus: "Strength" },
      { day_name: "Pull B", focus: "Volume" },
      { day_name: "Push B", focus: "Volume" },
    ]);

    expect(families.map((f) => f.label)).toEqual(["Push", "Pull", "Legs"]);
    expect(families[0].days.map((d) => d.day_name)).toEqual(["Push A", "Push B"]);
    expect(families[1].days.map((d) => d.day_name)).toEqual(["Pull A", "Pull B"]);
    expect(families[2].days.map((d) => d.day_name)).toEqual(["Legs"]);
  });

  it("keeps a plain three-day split as three pages", () => {
    const families = groupDaysByFamily([
      { day_name: "Push" },
      { day_name: "Pull" },
      { day_name: "Legs" },
    ]);
    expect(families.map((f) => f.label)).toEqual(["Push", "Pull", "Legs"]);
    expect(families.every((f) => f.days.length === 1)).toBe(true);
  });
});

describe("variantCaption", () => {
  it("names the variant once the family is already on the page", () => {
    expect(variantCaption("Push A", "push")).toBe("A");
    expect(variantCaption("Push B", "push")).toBe("B");
    expect(variantCaption("Legs", "legs")).toBeNull();
  });
});

describe("dayFamilyLabel", () => {
  it("title-cases the key for the tab", () => {
    expect(dayFamilyLabel("push")).toBe("Push");
    expect(dayFamilyLabel("upper body")).toBe("Upper Body");
  });
});
