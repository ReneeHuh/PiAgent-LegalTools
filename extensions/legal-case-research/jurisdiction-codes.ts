export interface FederalDistrictJurisdiction {
  scholar: string;
  scholarCode: string;
  courtlistener: string;
}

// Exact district-court values from Google Scholar's rendered court picker and
// CourtListener's active Federal District jurisdiction IDs (2026-08-29).
// Scholar code snapshot: https://developer.novada.com/novada/advanced-proxy-solutions/scraper-api-original/parametric/supported-google-scholar-courts.md
// CourtListener catalog: https://www.courtlistener.com/help/api/jurisdictions/
// The Northern Mariana Islands is absent because Scholar exposes no exact
// district entry for it in the current picker.
export const FEDERAL_DISTRICT_JURISDICTIONS: Readonly<Record<string, FederalDistrictJurisdiction>> = {
  "district of maine": { scholar: "d maine", scholarCode: "145", courtlistener: "med" },
  "district of massachusetts": { scholar: "d massachusetts", scholarCode: "147", courtlistener: "mad" },
  "district of new hampshire": { scholar: "d new hampshire", scholarCode: "152", courtlistener: "nhd" },
  "district of puerto rico": { scholar: "d puerto rico", scholarCode: "157", courtlistener: "prd" },
  "district of rhode island": { scholar: "d rhode island", scholarCode: "158", courtlistener: "rid" },
  "district of connecticut": { scholar: "d connecticut", scholarCode: "138", courtlistener: "ctd" },
  "district of vermont": { scholar: "d vermont", scholarCode: "162", courtlistener: "vtd" },
  "eastern district of new york": { scholar: "ed new york", scholarCode: "349", courtlistener: "nyed" },
  "northern district of new york": { scholar: "nd new york", scholarCode: "350", courtlistener: "nynd" },
  "southern district of new york": { scholar: "sd new york", scholarCode: "351", courtlistener: "nysd" },
  "western district of new york": { scholar: "wd new york", scholarCode: "352", courtlistener: "nywd" },
  "district of delaware": { scholar: "d delaware", scholarCode: "139", courtlistener: "ded" },
  "district of new jersey": { scholar: "d new jersey", scholarCode: "153", courtlistener: "njd" },
  "district of the virgin islands": { scholar: "d virgin islands", scholarCode: "163", courtlistener: "vid" },
  "eastern district of pennsylvania": { scholar: "ed pennsylvania", scholarCode: "361", courtlistener: "paed" },
  "middle district of pennsylvania": { scholar: "md pennsylvania", scholarCode: "362", courtlistener: "pamd" },
  "western district of pennsylvania": { scholar: "wd pennsylvania", scholarCode: "363", courtlistener: "pawd" },
  "district of maryland": { scholar: "d maryland", scholarCode: "146", courtlistener: "mdd" },
  "district of south carolina": { scholar: "d south carolina", scholarCode: "159", courtlistener: "scd" },
  "eastern district of north carolina": { scholar: "ed north carolina", scholarCode: "353", courtlistener: "nced" },
  "middle district of north carolina": { scholar: "md north carolina", scholarCode: "354", courtlistener: "ncmd" },
  "western district of north carolina": { scholar: "wd north carolina", scholarCode: "355", courtlistener: "ncwd" },
  "eastern district of virginia": { scholar: "ed virginia", scholarCode: "371", courtlistener: "vaed" },
  "western district of virginia": { scholar: "wd virginia", scholarCode: "372", courtlistener: "vawd" },
  "northern district of west virginia": { scholar: "nd west virginia", scholarCode: "375", courtlistener: "wvnd" },
  "southern district of west virginia": { scholar: "sd west virginia", scholarCode: "376", courtlistener: "wvsd" },
  "eastern district of louisiana": { scholar: "ed louisiana", scholarCode: "340", courtlistener: "laed" },
  "middle district of louisiana": { scholar: "md louisiana", scholarCode: "341", courtlistener: "lamd" },
  "western district of louisiana": { scholar: "wd louisiana", scholarCode: "342", courtlistener: "lawd" },
  "northern district of mississippi": { scholar: "nd mississippi", scholarCode: "345", courtlistener: "msnd" },
  "southern district of mississippi": { scholar: "sd mississippi", scholarCode: "346", courtlistener: "mssd" },
  "eastern district of texas": { scholar: "ed texas", scholarCode: "367", courtlistener: "txed" },
  "northern district of texas": { scholar: "nd texas", scholarCode: "368", courtlistener: "txnd" },
  "southern district of texas": { scholar: "sd texas", scholarCode: "369", courtlistener: "txsd" },
  "western district of texas": { scholar: "wd texas", scholarCode: "370", courtlistener: "txwd" },
  "eastern district of kentucky": { scholar: "ed kentucky", scholarCode: "338", courtlistener: "kyed" },
  "western district of kentucky": { scholar: "wd kentucky", scholarCode: "339", courtlistener: "kywd" },
  "eastern district of michigan": { scholar: "ed michigan", scholarCode: "343", courtlistener: "mied" },
  "western district of michigan": { scholar: "wd michigan", scholarCode: "344", courtlistener: "miwd" },
  "northern district of ohio": { scholar: "nd ohio", scholarCode: "356", courtlistener: "ohnd" },
  "southern district of ohio": { scholar: "sd ohio", scholarCode: "357", courtlistener: "ohsd" },
  "eastern district of tennessee": { scholar: "ed tennessee", scholarCode: "364", courtlistener: "tned" },
  "middle district of tennessee": { scholar: "md tennessee", scholarCode: "365", courtlistener: "tnmd" },
  "western district of tennessee": { scholar: "wd tennessee", scholarCode: "366", courtlistener: "tnwd" },
  "central district of illinois": { scholar: "cd illinois", scholarCode: "331", courtlistener: "ilcd" },
  "northern district of illinois": { scholar: "nd illinois", scholarCode: "332", courtlistener: "ilnd" },
  "southern district of illinois": { scholar: "sd illinois", scholarCode: "333", courtlistener: "ilsd" },
  "northern district of indiana": { scholar: "nd indiana", scholarCode: "334", courtlistener: "innd" },
  "southern district of indiana": { scholar: "sd indiana", scholarCode: "335", courtlistener: "insd" },
  "eastern district of wisconsin": { scholar: "ed wisconsin", scholarCode: "377", courtlistener: "wied" },
  "western district of wisconsin": { scholar: "wd wisconsin", scholarCode: "378", courtlistener: "wiwd" },
  "district of minnesota": { scholar: "minnesota", scholarCode: "148", courtlistener: "mnd" },
  "district of nebraska": { scholar: "d nebraska", scholarCode: "150", courtlistener: "ned" },
  "district of north dakota": { scholar: "d north dakota", scholarCode: "155", courtlistener: "ndd" },
  "district of south dakota": { scholar: "d south dakota", scholarCode: "160", courtlistener: "sdd" },
  "eastern district of arkansas": { scholar: "ed arkansas", scholarCode: "319", courtlistener: "ared" },
  "western district of arkansas": { scholar: "wd arkansas", scholarCode: "320", courtlistener: "arwd" },
  "northern district of iowa": { scholar: "nd iowa", scholarCode: "336", courtlistener: "iand" },
  "southern district of iowa": { scholar: "sd iowa", scholarCode: "337", courtlistener: "iasd" },
  "eastern district of missouri": { scholar: "ed missouri", scholarCode: "347", courtlistener: "moed" },
  "western district of missouri": { scholar: "wd missouri", scholarCode: "348", courtlistener: "mowd" },
  "district of alaska": { scholar: "d alaska", scholarCode: "134", courtlistener: "akd" },
  "district of arizona": { scholar: "d arizona", scholarCode: "135", courtlistener: "azd" },
  "district court of guam": { scholar: "d guam", scholarCode: "141", courtlistener: "gud" },
  "district of hawaii": { scholar: "d hawaii", scholarCode: "142", courtlistener: "hid" },
  "district of idaho": { scholar: "d idaho", scholarCode: "143", courtlistener: "idd" },
  "district of montana": { scholar: "d montana", scholarCode: "149", courtlistener: "mtd" },
  "district of nevada": { scholar: "d nevada", scholarCode: "151", courtlistener: "nvd" },
  "district of oregon": { scholar: "d oregon", scholarCode: "156", courtlistener: "ord" },
  "central district of california": { scholar: "cd california", scholarCode: "321", courtlistener: "cacd" },
  "eastern district of california": { scholar: "ed california", scholarCode: "322", courtlistener: "caed" },
  "northern district of california": { scholar: "nd california", scholarCode: "323", courtlistener: "cand" },
  "southern district of california": { scholar: "sd california", scholarCode: "324", courtlistener: "casd" },
  "eastern district of washington": { scholar: "ed washington", scholarCode: "373", courtlistener: "waed" },
  "western district of washington": { scholar: "wd washington", scholarCode: "374", courtlistener: "wawd" },
  "district of colorado": { scholar: "d colorado", scholarCode: "137", courtlistener: "cod" },
  "district of kansas": { scholar: "d kansas", scholarCode: "144", courtlistener: "ksd" },
  "district of new mexico": { scholar: "d new mexico", scholarCode: "154", courtlistener: "nmd" },
  "district of utah": { scholar: "d utah", scholarCode: "161", courtlistener: "utd" },
  "district of wyoming": { scholar: "d wyoming", scholarCode: "164", courtlistener: "wyd" },
  "eastern district of oklahoma": { scholar: "ed oklahoma", scholarCode: "358", courtlistener: "oked" },
  "northern district of oklahoma": { scholar: "nd oklahoma", scholarCode: "359", courtlistener: "oknd" },
  "western district of oklahoma": { scholar: "wd oklahoma", scholarCode: "360", courtlistener: "okwd" },
  "middle district of alabama": { scholar: "md alabama", scholarCode: "316", courtlistener: "almd" },
  "northern district of alabama": { scholar: "nd alabama", scholarCode: "317", courtlistener: "alnd" },
  "southern district of alabama": { scholar: "sd alabama", scholarCode: "318", courtlistener: "alsd" },
  "middle district of florida": { scholar: "md florida", scholarCode: "325", courtlistener: "flmd" },
  "northern district of florida": { scholar: "nd florida", scholarCode: "326", courtlistener: "flnd" },
  "southern district of florida": { scholar: "sd florida", scholarCode: "327", courtlistener: "flsd" },
  "middle district of georgia": { scholar: "md georgia", scholarCode: "328", courtlistener: "gamd" },
  "northern district of georgia": { scholar: "nd georgia", scholarCode: "329", courtlistener: "gand" },
  "southern district of georgia": { scholar: "sd georgia", scholarCode: "330", courtlistener: "gasd" },
  "district court for the district of columbia": { scholar: "dist of columbia", scholarCode: "140", courtlistener: "dcd" },
};

export const FEDERAL_DISTRICT_JURISDICTION_KEYS: readonly string[] =
  Object.keys(FEDERAL_DISTRICT_JURISDICTIONS);

export const FEDERAL_DISTRICT_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FEDERAL_DISTRICT_JURISDICTIONS).flatMap(([canonical, selection]) => [
    [canonical, canonical],
    [selection.scholar, canonical],
    [selection.courtlistener, canonical],
  ]),
);

export const SCHOLAR_FEDERAL_DISTRICT_CODES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(FEDERAL_DISTRICT_JURISDICTIONS).map((selection) => [selection.scholar, selection.scholarCode]),
);

// Individual federal appellate-court codes captured from Google Scholar's
// Select courts picker (scholar_courts, 2026-08-15).
export const SCHOLAR_FEDERAL_APPELLATE_CODES: Readonly<Record<string, string>> = {
  "1st circuit court of appeals": "119",
  "2nd circuit court of appeals": "122",
  "3rd circuit court of appeals": "123",
  "4th circuit court of appeals": "124",
  "5th circuit court of appeals": "125",
  "6th circuit court of appeals": "126",
  "7th circuit court of appeals": "127",
  "8th circuit court of appeals": "128",
  "9th circuit court of appeals": "129",
  "10th circuit court of appeals": "120",
  "11th circuit court of appeals": "121",
  "dc circuit court of appeals": "130",
  "federal circuit court of appeals": "131",
};

/** Apply CourtListener's rendered-search checkbox field format. */
export function appendCourtListenerCourts(params: URLSearchParams, courtIds: readonly string[]): void {
  for (const courtId of courtIds) params.set(`court_${courtId}`, "on");
}
