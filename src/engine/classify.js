// What kind of place is this? Google types (or OpenStreetMap tags) -> one
// category -> one of ten themes. Matching is by explicit priority so the same
// input always gives the same answer.

// Routine errands and services: never travel memories.
export const ROUTINE_TYPES = new Set([
  "bank", "atm", "hospital", "pharmacy", "drugstore", "dentist", "doctor", "medical_lab",
  "physiotherapist", "veterinary_care", "health", "gym", "fitness_center",
  "gas_station", "electric_vehicle_charging_station", "car_repair", "car_wash",
  "car_dealer", "auto_parts_store", "motorcycle_repair",
  "supermarket", "grocery_store", "convenience_store", "liquor_store", "florist",
  "laundry", "dry_cleaning", "beauty_salon", "hair_care", "hair_salon", "nail_salon", "barber_shop",
  "post_office", "police", "fire_station", "local_government_office", "city_hall", "courthouse",
  "embassy", "parking", "storage", "real_estate_agency", "insurance_agency", "lawyer",
  "accounting", "corporate_office", "electrician", "plumber", "general_contractor",
  "painter", "locksmith", "moving_company", "home_goods_store", "furniture_store",
  "hardware_store", "home_improvement_store", "paint_store", "pet_store",
  "school", "primary_school", "secondary_school", "preschool", "university", "library",
  "child_care_agency", "cell_phone_store",
]);

// Specific before generic: a temple tagged tourist_attraction is still a temple.
// These win even when a routine type is also present.
export const STRONG_TYPES = [
  "historical_landmark", "historical_place", "monument", "castle", "fort", "palace",
  "cultural_landmark", "observation_deck", "viewpoint",
  "museum", "art_gallery", "planetarium", "aquarium", "zoo", "wildlife_park",
  "wildlife_refuge", "performing_arts_theater", "concert_hall", "opera_house", "cultural_center",
  "national_park", "state_park", "hiking_area", "beach", "waterfall", "cave",
  "natural_feature", "botanical_garden", "garden", "park", "marina", "campground",
  "hindu_temple", "church", "cathedral", "mosque", "synagogue", "buddhist_temple", "place_of_worship",
  "amusement_park", "water_park", "ferris_wheel", "roller_coaster", "casino",
  "stadium", "arena", "golf_course",
  "tourist_attraction", "visitor_center", "tourist_information",
];

export const WEAK_TYPES = [
  "resort_hotel", "resort", "hotel", "motel", "hostel", "guest_house", "bed_and_breakfast",
  "farmstay", "cottage", "inn", "lodging",
  "restaurant", "cafe", "coffee_shop", "bakery", "ice_cream_shop", "bar", "meal_takeaway", "food",
  "airport", "train_station", "bus_station", "subway_station", "ferry_terminal",
  "transit_station", "rest_stop", "travel_agency", "park_and_ride",
  "movie_theater", "night_club", "bowling_alley", "sports_complex", "convention_center", "event_venue",
  "shopping_mall", "market", "department_store", "book_store", "gift_shop",
  "clothing_store", "jewelry_store", "shoe_store", "electronics_store", "shopping_center", "bicycle_store",
];

const first = (present, ordered) => ordered.find((t) => present.has(t)) ?? null;

/** { category, routine } from a list of Google place types. */
export function categoryFromTypes(types) {
  if (!types?.length) return { category: null, routine: false };
  const present = new Set(types);
  const strong = first(present, STRONG_TYPES);
  if (strong) return { category: strong, routine: false };
  const routine = [...ROUTINE_TYPES].sort().find((t) => present.has(t));
  if (routine) return { category: routine, routine: true };
  let weak = first(present, WEAK_TYPES);
  if (!weak && types.some((t) => String(t).endsWith("_restaurant"))) weak = "restaurant";
  return { category: weak, routine: false };
}

// ---- themes --------------------------------------------------------------------------

export const THEMES = ["landmark", "nature", "worship", "culture", "fun", "food", "stay", "transit", "shopping", "other"];

const THEME_GROUPS = {
  landmark: ["historical_landmark", "historical_place", "monument", "castle", "fort", "palace",
    "cultural_landmark", "observation_deck", "viewpoint", "tourist_attraction", "visitor_center",
    "tourist_information", "plaza"],
  nature: ["national_park", "state_park", "hiking_area", "beach", "waterfall", "cave", "natural_feature",
    "botanical_garden", "garden", "park", "marina", "campground", "wildlife_park", "wildlife_refuge"],
  worship: ["hindu_temple", "church", "cathedral", "mosque", "synagogue", "buddhist_temple", "place_of_worship"],
  culture: ["museum", "art_gallery", "planetarium", "aquarium", "zoo", "performing_arts_theater",
    "concert_hall", "opera_house", "cultural_center"],
  fun: ["amusement_park", "water_park", "ferris_wheel", "roller_coaster", "casino", "stadium", "arena",
    "golf_course", "movie_theater", "night_club", "bowling_alley", "sports_complex", "convention_center",
    "event_venue"],
  food: ["restaurant", "cafe", "coffee_shop", "bakery", "ice_cream_shop", "bar", "meal_takeaway", "food"],
  stay: ["resort_hotel", "resort", "hotel", "motel", "hostel", "guest_house", "bed_and_breakfast",
    "farmstay", "cottage", "inn", "lodging"],
  transit: ["airport", "train_station", "bus_station", "subway_station", "ferry_terminal",
    "transit_station", "rest_stop", "travel_agency", "park_and_ride"],
  shopping: ["shopping_mall", "market", "department_store", "book_store", "gift_shop", "clothing_store",
    "jewelry_store", "shoe_store", "electronics_store", "shopping_center", "bicycle_store", "store"],
};
const THEME_OF = new Map(Object.entries(THEME_GROUPS).flatMap(([theme, cats]) => cats.map((c) => [c, theme])));

export function themeFor(category) {
  if (!category) return "other";
  return THEME_OF.get(category) ?? (String(category).endsWith("_restaurant") ? "food" : "other");
}

// ---- OpenStreetMap tags -> the same categories ------------------------------------------

const OSM_RULES = [
  ["historic", { castle: "castle", fort: "fort", palace: "palace", monument: "monument", memorial: "monument",
    archaeological_site: "historical_landmark", ruins: "historical_landmark", "*": "historical_landmark" }],
  ["tourism", { museum: "museum", gallery: "art_gallery", zoo: "zoo", aquarium: "aquarium",
    theme_park: "amusement_park", viewpoint: "viewpoint", attraction: "tourist_attraction",
    hotel: "hotel", motel: "motel", hostel: "hostel", guest_house: "guest_house", resort: "resort",
    chalet: "cottage", camp_site: "campground", information: "tourist_information" }],
  ["amenity", { place_of_worship: "place_of_worship", restaurant: "restaurant", cafe: "cafe",
    fast_food: "meal_takeaway", bar: "bar", pub: "bar", ice_cream: "ice_cream_shop", cinema: "movie_theater",
    theatre: "performing_arts_theater", arts_centre: "cultural_center", marketplace: "market",
    bus_station: "bus_station", ferry_terminal: "ferry_terminal", fuel: "gas_station", bank: "bank",
    atm: "atm", hospital: "hospital", pharmacy: "pharmacy", school: "school", university: "university",
    parking: "parking", library: "library" }],
  ["leisure", { park: "park", garden: "garden", nature_reserve: "national_park", water_park: "water_park",
    stadium: "stadium", golf_course: "golf_course", marina: "marina", beach_resort: "beach",
    fitness_centre: "gym" }],
  ["natural", { beach: "beach", peak: "natural_feature", waterfall: "waterfall", cave_entrance: "cave",
    water: "natural_feature", "*": "natural_feature" }],
  ["boundary", { national_park: "national_park", protected_area: "national_park" }],
  ["aeroway", { aerodrome: "airport", terminal: "airport" }],
  ["railway", { station: "train_station", halt: "train_station" }],
  ["public_transport", { station: "transit_station" }],
  ["shop", { mall: "shopping_mall", department_store: "department_store", books: "book_store",
    gift: "gift_shop", clothes: "clothing_store", jewelry: "jewelry_store", supermarket: "supermarket",
    convenience: "convenience_store", "*": "store" }],
];

/** Category from OSM tags, with the same routine flag as Google types. */
export function categoryFromOsm(tags = {}) {
  let category = null;
  if (tags.amenity === "place_of_worship") {
    const religion = tags.religion;
    category = religion === "hindu" ? "hindu_temple" : religion === "christian" ? "church"
      : religion === "muslim" ? "mosque" : religion === "jewish" ? "synagogue"
        : religion === "buddhist" ? "buddhist_temple" : "place_of_worship";
  }
  for (const [key, map] of OSM_RULES) {
    if (category) break;
    const value = tags[key];
    if (value) category = map[value] ?? map["*"] ?? null;
  }
  return { category, routine: category ? ROUTINE_TYPES.has(category) : false };
}

/** How interesting an OSM feature is as the identity of a visit (higher wins). */
export function osmSignificance(tags = {}) {
  if (tags.tourism || tags.historic) return 3;
  if (tags.amenity === "place_of_worship" || tags.leisure || tags.natural || tags.aeroway || tags.railway) return 2;
  if (tags.amenity || tags.shop) return 1;
  return 0;
}
