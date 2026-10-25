# AirNow forecast web service: what is documented, and what HALO builds on

Retrieved 2026-10-25 for B10 Task 5 (the AirNow forecast adapter, `lib/forecast/airnow.js`).
Status: **built on the public record below; the authenticated documentation page was not reachable.**

## The short answer

- **The service the B10 plan named is retired.** AirNow's own June 2026 notice lists "Forecast by
  Latitude/Longitude, `/aq/forecast/latLong/`" and "Forecast by ZIP Code, `/aq/forecast/zipCode/`" as
  "Retirement September 30, 2026", replaced by "Current Forecasts by Reporting Area,
  `/aq/forecast/current/`", which "Retrieves current and forecasted air quality conditions by Reporting
  Area using a ZIP Code, or Latitude/Longitude, or the Reporting Area code." Today is past that date, so
  the adapter calls `/aq/forecast/current/`.
- **The per-service documentation is behind the login.** `https://docs.airnowapi.org/CurrentForecasts/docs`,
  `/CurrentForecasts/query`, `/ForecastsByLatLon/docs` and `/ForecastsByZip/docs` each return the
  "AirNow API - Log In" page (checked 2026-10-25). The exact parameter table, the per-service hourly
  limit and the meaning of `aqi: -1` are therefore taken from the public sources below, not from the
  authenticated page. The adapter is written so that a difference found later changes one parser.
- **The same retirement affected HALO's AirNow observations, now moved.** `lib/dailyReadings.js` (used
  by `/api/daily-score`, the daily cron and backfill) and the `/api/health` probe called
  `/aq/observation/latLong/current/`, which is on the same retirement list ("Current Observations by
  Reporting Area by Latitude/Longitude ... Retirement September 30, 2026"; replacement "Current
  Observations by Latitude/Longitude or ZIP Code, `/aq/observation/current/ziplatlong/`"). Both now call
  the replacement; see "Observations" below. The daily-maxima recorder and the map's station layer use
  `/aq/data/`, which AirNow lists as "Remain".

## Sources (all retrieved 2026-10-25)

| # | Source | What it supports |
| --- | --- | --- |
| S1 | AirNow, "Dear AirNow API users" (June 17, 2026), https://docs.airnowapi.org/docs/AirNowAPIUpdates2026June.pdf | The new services and their base URLs, the six retired services, the retirement date and the replacement matrix ("Forecast by Latitude/Longitude: Current Forecasts by Reporting Area") |
| S2 | AirNow API Fact Sheet, https://docs.airnowapi.org/docs/AirNowAPIFactSheet.pdf | "An AirNow API account is required to access these services"; "The Documentation sub-page for each web service defines the input and output parameters"; "Data can be returned in CSV, JSON, or XML formats"; "in September 2026, six existing API web services were retired and replaced with new ones" |
| S3 | AirNow API Web Services, https://docs.airnowapi.org/webservices | "Current Forecasts: By Reporting Area, Lat/Long, or Zip Code. Get current forecast AQI values and categories by reporting area, lat/long, or zip code." |
| S4 | AirNow API FAQ, https://docs.airnowapi.org/faq | "forecasts are not necessarily available for all reporting areas"; "Forecasts may not be issued every day or may be seasonal"; "Forecasts may cover from one to six days"; "Forecasts may include an AQI number (e.g., 51) or simply an AQI category (e.g., Moderate or Unhealthy)"; "A forecast discussion may or may not be included"; "forecasts are issued once per day"; "we recommend users cache daily or hourly air quality observation or forecast data retrieved via web services"; "Users must limit web service calls for a given API key to the maximum permitted for the web service"; "If this limit is met within a specific hour, the web service will not return data until the next hour"; "rate limits cannot be changed"; "Reporting areas vary by size and population, covering anywhere from part of a city to an entire county area" |
| S5 | AirNow Data Exchange Guidelines, https://docs.airnowapi.org/docs/DataUseGuidelines.pdf (quoted in the B10 plan, retrieved 2026-10-19) | Values "should not be altered in any way and should be disseminated as received"; credit to the agencies and the EPA AirNow program; products relying on the data "must be made known" to the agencies and the AirNow program (`dmc@airnowtech.org`) |
| S6 | briandconnelly/airnow (R client), migration design dated 2026-09-09, revised 2026-09-12, https://github.com/briandconnelly/airnow/blob/HEAD/dev/superpowers/specs/2026-09-09-airnow-api-migration-design.md, with recorded probe payloads under `dev/superpowers/probes/new/` | Secondhand but recorded against the live service: field names, the "no data" envelope, `distance` ignored, rows per date, the 500 per hour allowance |
| S7 | asymworks/pyairnow (the Home Assistant AirNow library), https://github.com/asymworks/pyairnow/blob/HEAD/pyairnow/forecast.py and `api.py` | Secondhand: the request uses `API_KEY` and `format=application/json` against `aq/forecast/current`; the new camelCase fields map one to one onto the retired PascalCase ones |

S6 and S7 are third-party code, not AirNow's documentation. They are used only where they agree with
each other and with the recorded payloads, and every point that rests on them is marked below.

## The request

```
GET https://www.airnowapi.org/aq/forecast/current/?format=application/json&latitude=<lat>&longitude=<lng>&API_KEY=<key>
```

| Parameter | Value | Basis |
| --- | --- | --- |
| `format` | `application/json` | S2 (JSON is offered); S7 sends exactly this |
| `latitude`, `longitude` | the 2-decimal point from `roundForProvider` (F3) | S1 ("using a ... Latitude/Longitude"); S6 and S7 |
| `API_KEY` | `process.env.AIRNOW_API_KEY`, the same variable and the same parameter spelling as the observation call (`lib/dailyReadings.js:155`) | S7 sends `API_KEY`; S6 reports `api_key` accepted and `apiKey` refused on the historical service, so the name is case-insensitive in practice |
| `date` | **not sent** | The new service is "current and forecasted" conditions: one call returns every validity date the agency issued (S6 recorded six dates, 2026-09-09 to 2026-09-14, from one call). The route filters by the planned date. |
| `distance` | **not sent** | S6: "`distance` is ignored by the new services (verified 2026-09-12) ... The search radius is now fixed per reporting area." |

The key is in the query string, so the URL is never logged or echoed (`lib/forecast/http.js`).

## The response

A JSON array, one object per pollutant per validity date. Recorded shape (S6,
`forecast_current__latlong.json`, a lat/long request for Napa, CA; one row shown):

```json
{"dateIssue":"2026-09-09","dateValid":"2026-09-10","reportingArea":"Napa","reportingAreaCode":"ca064","stateCode":"CA","parameterName":"PM2.5","aqi":50,"forecastAgency":"Bay Area Air District","categoryNumber":1,"categoryName":"Good","actionDay":false,"discussion":""}
```

| Field (new service) | Retired service's name | HALO use |
| --- | --- | --- |
| `dateIssue` | `DateIssue` | Issue date in coverage and the period version; must be `YYYY-MM-DD` after trimming |
| `dateValid` | `DateForecast` | The forecast's calendar date; must be `YYYY-MM-DD` after trimming |
| `reportingArea` | `ReportingArea` | Named as received in coverage ("for the Charlotte, NC reporting area") |
| `stateCode` | `StateCode` | Appended to the area name |
| `parameterName` | `ParameterName` | The pollutant, shown as received (`OZONE` in the new service, `O3` in the old, both named "ozone") |
| `aqi` | `AQI` | The AQI number; **`-1`, missing or not a finite number means no number was issued**, never a low value |
| `categoryNumber`, `categoryName` | `Category.Number`, `Category.Name` | The category name as received, kept only if it is one of AirNow's six: Good, Moderate, Unhealthy for Sensitive Groups, Unhealthy, Very Unhealthy, Hazardous. Number 7 ("Unavailable", documented per S6, never observed) and any other name are not a category |
| `actionDay` | `ActionDay` | "An air quality action day is declared." |
| `discussion` | `Discussion` | Not used (F6) |
| `reportingAreaCode`, `forecastAgency` | (new) | Not used |
| (none) | `Latitude`, `Longitude` | The retired service returned the reporting area's point; the new one does not (S6 joins a metadata file to get it). HALO does not compute a distance and never claims one |

**`aqi: -1`.** The recorded payload carries `"aqi":-1` with `"categoryName":"Good"` on four of six rows,
the days further out: a category was forecast, a number was not. This matches S4 ("may include an AQI
number ... or simply an AQI category"). The authenticated page's own wording for `-1` was not seen.

**No forecast.** "No data is a `200` with a `WebServiceError` body, not an empty array" (S6). Recorded:
`{"WebServiceError":[{"Message":"Error - There is no reporting area at your searched location"}]}`. The
adapter reads that one message as "no forecast for this area" (`ok: true`, no rows); any other
`WebServiceError` is a failure (`provider_error`), never "no forecast". An empty array, the retired
service's way of saying the same, is also read as no rows.

**Authentication failure.** A `401` with the same envelope (S6); the helper reports `http_401`.

**Rows per date.** One call can return several pollutants for one date and several dates (S6: the old
ZIP service returned 5 rows, the new one 10, for the same ZIP). AirNow reports each pollutant's own
forecast; HALO lists each as received and names the worst for the Air card, never averaging.

## Rate limit and budget

S4: a per-service hourly limit, "cannot be changed", and when it is met "the web service will not return
data until the next hour". The number is on the authenticated page. Publicly reported as 500 per hour per
key (S6: "the same 500/hour allowance"; the Home Assistant integration page cited in the B10 plan). The
forecast budget stays at **200 an hour** (`lib/forecast/budgets.js`, 40% of 500), leaving room for the
observation calls that share the key. Each answer is cached for the hour per rounded point (F9), which
S4 recommends.

## Horizon

"Forecasts may cover from one to six days" (S4) and "are issued once per day". The forecast's weather
horizon is today plus at most 6 (F12); an AirNow date outside the dates AirNow returned is "no air
forecast for this date", with the dates it did issue named in coverage.

## Observations (`/aq/observation/current/ziplatlong/`)

Request: `format=application/json`, `latitude`, `longitude`, `API_KEY`; no `distance` ("`distance` is
ignored by the new services", S6, which recorded byte-identical answers with and without it).

Recorded answer (S6, `observation_current_ziplatLong__latlong.json`, one row shown):

```json
{"dateObserved":"2026-09-12","hourObserved":"08:00","localTimeZone":"PDT","reportingAreaName":"Napa","siteID":"060950004","siteName":"Vallejo","parameterName":"PM2.5","nowcastAQI":52,"aqiCategoryName":"Moderate","reportingAgency":"Bay Area Air District","lookupBehavior":"Closest Reading By Pollutant","consideredMonitors":"All","lookupBoundary":"50 Miles"}
```

| New field | Retired field | HALO use |
| --- | --- | --- |
| `parameterName` (`OZONE`, `PM2.5`, `PM10`) | `ParameterName` (`O3`, ...) | The dominant pollutant, normalised to O3, PM2.5, PM10 |
| `nowcastAQI` | `AQI` | The reading; HALO's AQI is the highest; `-1`, missing or negative is unknown and never a reading |
| `aqiCategoryName`, `dateObserved`, `hourObserved`, `siteID`, `reportingAreaName` | `Category.Name`, `DateObserved`, `HourObserved`, (none), `ReportingArea` | Not stored, as before: `fetchDailyReadings` kept only the AQI, the source (measured AirNow) and the dominant pollutant. S6: `hourObserved` labels the END of the hour ("18:00" for 17:00 to 17:59), one hour later than the retired `HourObserved` |

No monitor in range is a 200 `{"WebServiceError":[{"Message":"There are no observations available for
the requested latitude/longitude: No observations were found for all monitors within 50 miles."}]}`
(recorded, S6). That, an empty array, only unknown values, or any failure falls back to Open-Meteo's
modeled AQI, labelled modeled, as before. S6 also found the new service's values can differ from the
retired one's for the same instant ("The lookup methodologies differ"): one row per pollutant from its
closest monitor.

## What Vibhav still has to do

1. Log in once and compare `https://docs.airnowapi.org/CurrentForecasts/docs` with the request and
   field tables above (parameter spelling, the `-1` wording, the hourly limit). If the limit is below
   500, set the AirNow budget to 40% of it.
2. Send the AirNow data-use notification (S5) to `dmc@airnowtech.org`, or confirm the API key request
   covered it (`YOUR_TODO.md` Part 3 item 10b).
3. Check the observation request against `https://docs.airnowapi.org/CurrentObservationsByLatLon/docs`
   (or the ziplatlong service's own page) the same way: `lib/dailyReadings.js` and `/api/health` now call
   `/aq/observation/current/ziplatlong/`, built from the recorded answers above.
