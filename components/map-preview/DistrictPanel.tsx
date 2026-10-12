"use client";

import { ArrowUpRight, ChevronDown, CircleHelp, Droplets, MapPinned, RefreshCw, TriangleAlert, UsersRound } from "lucide-react";
import {
  districtGeographyUnavailable,
  districtPreviewData,
  districtWaterCoverageFixture,
  unlocatedDistrictPreviewSystems,
  type DistrictCompound,
  type DistrictPreviewVariant,
  type DistrictWaterSeverity,
} from "@/lib/frontend/map-district-preview";
import "./district-panel.css";

export { districtFixture } from "@/lib/frontend/map-district-preview";

type DistrictPanelProps = {
  variant?: DistrictPreviewVariant;
  onRetry?: () => void;
  onCountySelect?: (county: string) => void;
};

const formatNumber = new Intl.NumberFormat("en-US");
const formatPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const waterLabels: Record<DistrictWaterSeverity, string> = {
  good: "Good", moderate: "Moderate", elevated: "Elevated", high: "High", severe: "Severe", no_data: "No data",
};
const compoundNames: DistrictCompound[] = ["PFOA", "PFOS", "PFHxS", "PFNA", "HFPO-DA"];

export function DistrictPanel({ variant = "full", onRetry, onCountySelect }: DistrictPanelProps) {
  const data = districtPreviewData(variant);
  const geographyUnavailable = districtGeographyUnavailable(data.total_systems,
    variant === "geography-error" ? { count: 15, located: 1 } : districtWaterCoverageFixture);
  const comparison = data.state_comparison;
  const hasComparison = comparison.district_share_over !== null && comparison.state_share_over !== null;
  const isZero = data.systems_over_limit === 0;

  return (
    <div className="halo-map-district">
      <header className="halo-map-district-heading">
        <span className="halo-map-district-kicker"><MapPinned size={15} aria-hidden="true" /> Community perspective</span>
        <h2>A wider view of NC-08</h2>
        <p>Connect the local water picture with the district around it.</p>
      </header>

      {variant === "error" || geographyUnavailable ? (
        <section className="halo-map-district-error" aria-label="District information unavailable">
          <TriangleAlert size={30} aria-hidden="true" />
          <h3>{geographyUnavailable ? "The district picture is incomplete" : "District information could not load"}</h3>
          <p>{geographyUnavailable
            ? "Too few systems could be placed within a reliable geography. We cannot show a district total or an all-clear from this response."
            : "The map can still be explored. District totals and comparisons are unavailable until this request succeeds."}</p>
          {onRetry && <button className="halo-map-district-retry" type="button" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Try district again</button>}
        </section>
      ) : (
        <>
          <section className="halo-map-district-hero" aria-label="District water summary">
            <div className="halo-map-district-hero-icon"><UsersRound size={26} aria-hidden="true" /></div>
            {data.affected_population !== null ? (
              <>
                {!data.affected_population_complete && <span className="halo-map-district-minimum">At least</span>}
                <strong className="halo-map-district-total">{formatNumber.format(data.affected_population)}</strong>
                <p className="halo-map-district-hero-caption">{isZero ? "people served by over-limit systems in this returned dataset" : "people served by systems with an over-limit sample"}</p>
              </>
            ) : (
              <>
                <strong className="halo-map-district-total">{data.systems_over_limit}</strong>
                <p className="halo-map-district-hero-caption">systems have an over-limit sample</p>
                <p className="halo-map-district-note">Population served is unavailable. The number of systems is shown instead.</p>
              </>
            )}
            <div className="halo-map-district-hero-facts">
              <span><b>{data.systems_over_limit}</b> systems over a limit</span>
              <span><b>{data.total_systems}</b> mapped district systems</span>
            </div>
            <p className="halo-map-district-note">{isZero
              ? "No over-limit result was returned for the available records. This is not proof that every system was tested or that every home has the same water."
              : "This is the population served by those systems, not a count of people with a measured personal exposure."}</p>
            {!data.affected_population_complete && data.affected_population !== null && (
              <p className="halo-map-district-coverage-note">Population is unknown for {data.over_limit_population_unknown} of the over-limit systems. The total is a minimum.</p>
            )}
          </section>

          <section className="halo-map-district-section" aria-labelledby="district-comparison-title">
            <div className="halo-map-district-section-title"><Droplets size={20} aria-hidden="true" /><h3 id="district-comparison-title">District &amp; state, in context</h3></div>
            {hasComparison ? (
              <figure className="halo-map-district-comparison">
                {[
                  { label: "NC-08", share: comparison.district_share_over!, district: true },
                  { label: "North Carolina", share: comparison.state_share_over!, district: false },
                ].map(({ label, share, district }) => (
                  <div className="halo-map-district-bar-row" key={label}>
                    <div><span>{label}</span><strong>{formatPercent.format(share)}</strong></div>
                    <div className="halo-map-district-bar-track" aria-hidden="true"><span className={district ? "is-district" : "is-state"} style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} /></div>
                  </div>
                ))}
                <figcaption>Share of tested systems with at least one over-limit result. NC-08: {data.systems_over_limit} of {data.systems_tested_any}. Each bar uses its own tested-system denominator.</figcaption>
              </figure>
            ) : <p className="halo-map-district-inline-notice">The district/state comparison is unavailable because one tested-system share is missing. No substitute percentage is shown.</p>}
            <details className="halo-map-district-explainer">
              <summary><CircleHelp size={16} aria-hidden="true" /><span>What does “tested” mean here?</span><ChevronDown size={16} aria-hidden="true" /></summary>
              <p>“Tested” counts systems with a numeric regulated-compound result, not all testing. Systems with only non-detect records may be missing.</p>
              <p>These summaries use each compound’s latest available sample, so the underlying samples can have different dates.</p>
            </details>
          </section>

          <section className="halo-map-district-section" aria-labelledby="district-counties-title">
            <h3 id="district-counties-title">Nine counties, different coverage</h3>
            <p className="halo-map-district-note">Water figures include only systems placed within this district. “Partial” means only part of that county is in the boundary.</p>
            <div className="halo-map-district-county-list">
              {data.counties.map((county) => {
                const contents = <>
                  <div className="halo-map-district-county-name"><strong>{county.county.replace(" County", "")}</strong>{county.in_district === "partial" && <span className="halo-map-district-partial">Partial</span>}{onCountySelect && <ArrowUpRight size={15} aria-hidden="true" />}</div>
                  <div className="halo-map-district-county-detail"><span className="halo-map-district-severity" data-severity={county.worst_water_severity}><span aria-hidden="true" />Water: {waterLabels[county.worst_water_severity]}</span><span>Radon: {county.radon_zone ? `Zone ${county.radon_zone}` : "No data"}</span></div>
                  <span className="halo-map-district-county-count">{county.systems === 0 ? "No mapped district water data" : `${county.systems_over_limit} of ${county.systems} systems over a limit`}</span>
                </>;
                return onCountySelect
                  ? <button key={county.county} className="halo-map-district-county" type="button" onClick={() => onCountySelect(county.county)} aria-label={`Explore ${county.county} on the map`}>{contents}</button>
                  : <div key={county.county} className="halo-map-district-county">{contents}</div>;
              })}
            </div>
            <p className="halo-map-district-note">Water severity is the highest available category among included systems, not a county-wide average. A radon zone describes regional potential, not a test result at an individual home.</p>
          </section>

          <section className="halo-map-district-section" aria-labelledby="district-compounds-title">
            <h3 id="district-compounds-title">Look inside the water findings</h3>
            <p className="halo-map-district-note">Open a compound to inspect its counts. Systems can appear under more than one compound, so these rows should not be added together.</p>
            <div className="halo-map-district-compounds">
              {compoundNames.map((name) => {
                const compound = data.by_contaminant[name];
                return <details key={name} className="halo-map-district-compound">
                  <summary><span>{name === "HFPO-DA" ? "HFPO-DA (GenX)" : name}</span><span className="halo-map-district-compound-count">{compound.tested === 0 ? "No data" : `${compound.over} of ${compound.tested} over`}</span><ChevronDown size={17} aria-hidden="true" /></summary>
                  <div className="halo-map-district-compound-body">
                    {compound.tested === 0 ? <p>No numeric records were returned for {name === "HFPO-DA" ? "HFPO-DA (GenX)" : name}. This is missing information, not a finding of no concern.</p> : <p><strong>{compound.over} of {compound.tested} systems</strong> with a numeric record for {name === "HFPO-DA" ? "HFPO-DA (GenX)" : name} have a latest sample above the returned limit.</p>}
                    <dl><div><dt>Systems tested</dt><dd>{compound.tested}</dd></div><div><dt>Systems over limit</dt><dd>{compound.tested === 0 ? "Not available" : compound.over}</dd></div><div><dt>Comparison limit in this response</dt><dd>{compound.limit} ppt</dd></div><div><dt>People served by over-limit systems</dt><dd>{compound.population_over === null ? "Not available" : `${compound.over_population_unknown > 0 ? "At least " : ""}${formatNumber.format(compound.population_over)}`}</dd></div></dl>
                    <p className="halo-map-district-note">Comparison uses the supplied limit, not a determination of current regulation.</p>
                    {compound.over_population_unknown > 0 && <p className="halo-map-district-note">Population is unknown for {compound.over_population_unknown} over-limit {compound.over_population_unknown === 1 ? "system" : "systems"} in this row.</p>}
                    {compound.over === 0 && compound.tested > 0 && <p className="halo-map-district-note">Zero over-limit findings in the available records does not establish complete testing or no risk.</p>}
                  </div>
                </details>;
              })}
            </div>
          </section>

          <aside className="halo-map-district-unlocated">
            <MapPinned size={21} aria-hidden="true" />
            <div><h3>{data.unlocated_systems} statewide systems could not be placed</h3>
              <p>These North Carolina records have no mapped service-area location. Their district membership is unknown, so they are not included in the district figures.</p>
              <details><summary>See unmapped systems <ChevronDown size={15} aria-hidden="true" /></summary><ul>{unlocatedDistrictPreviewSystems.map((name) => <li key={name}>{name}</li>)}</ul><p className="halo-map-district-note">Statewide list. These systems are not confirmed within NC-08.</p></details>
            </div>
          </aside>
        </>
      )}

      <footer className="halo-map-district-sources">
        <strong>Sources &amp; boundaries</strong>
        <p>Source basis: EPA UCMR 5, with EPA population and service-area boundaries.</p>
        <p>Boundaries: U.S. Census Bureau TIGERweb, 119th Congressional Districts and counties. NC-08 uses the 2023 district map, not the 2026 election map. District membership uses system service-area centroids.</p>
        <p>Boundary source retrieved September 27, 2026. Records assembled <time dateTime={data.assembled_at}>October 1, 2026 at 11:00 UTC</time>. Assembly time is not a water-sample date.</p>
      </footer>
    </div>
  );
}
