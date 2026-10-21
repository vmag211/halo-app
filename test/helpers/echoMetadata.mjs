// EPA ECHO fixtures for the facilities layer (no network).
//
// ECHO_COLUMN_IDS are the ids ECHO's metadata endpoint published on 2026-10-21
// (echo_rest_services.metadata?output=JSON, Results.ResultColumns[]), after EPA
// renumbered the columns. fakeEcho answers like ECHO does: get_qid returns only
// the columns whose ids were asked for in qcolumns, keyed by ObjectName.

export const ECHO_COLUMN_IDS = {
  FacName: 1,
  RegistryID: 6,
  FacCounty: 7,
  FacNAICSCodes: 8,
  FacLat: 19,
  FacLong: 20,
  FacQtrsWithNC: 37,
  FacComplianceStatus: 38,
  CAAComplianceStatus: 39,
  CWAComplianceStatus: 40,
  RCRAComplianceStatus: 41,
  SDWAComplianceStatus: 42,
  FacDateLastInspection: 45,
  FacTotalPenalties: 62,
  AIRFlag: 100,
  NPDESFlag: 101,
  SDWISFlag: 102,
  RCRAFlag: 103,
  TRIFlag: 104,
};

/** A metadata body in ECHO's shape for a {ObjectName: ColumnID} map. */
export function echoMetadata(ids = ECHO_COLUMN_IDS) {
  return {
    Results: {
      Message: 'Success',
      ResultColumns: Object.entries(ids).map(([ObjectName, id]) => ({ ColumnName: ObjectName.toUpperCase(), DataType: 'VARCHAR2', ColumnID: String(id), ObjectName })),
    },
  };
}

export const ECHO_METADATA = echoMetadata();

/**
 * A fetchImpl standing in for ECHO.
 * @param {object} o
 * @param {Array<object>} o.facilities  full rows; get_qid trims them to the requested columns
 * @param {object} [o.metadata]  the metadata body (defaults to the current ids)
 * @param {(url: string) => object} [o.head]  the get_facilities body (defaults to one query with all rows)
 */
export function fakeEcho({ facilities = [], metadata = ECHO_METADATA, head } = {}) {
  const calls = [];
  const byId = new Map((metadata?.Results?.ResultColumns || []).map((c) => [String(c.ColumnID), c.ObjectName]));
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    if (!href.startsWith('https://echodata.epa.gov/echo/echo_rest_services.')) throw new TypeError('unexpected host');
    let body;
    if (href.includes('.metadata?')) body = metadata;
    else if (href.includes('.get_facilities?')) body = head ? head(href) : { Results: { QueryID: 'q1', QueryRows: String(facilities.length) } };
    else if (href.includes('.get_qid?')) {
      const wanted = new Set((new URL(href).searchParams.get('qcolumns') || '').split(',').map((id) => byId.get(id)).filter(Boolean));
      body = { Results: { Facilities: facilities.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => wanted.has(k)))) } };
    } else throw new TypeError('unexpected ECHO service');
    return { ok: true, json: async () => body };
  };
  return { fetchImpl, calls };
}
