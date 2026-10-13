'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { evidenceForFood, type FoodContaminant, type FoodEvidenceQuery } from '@/lib/frontend/food-evidence';
import { foodGuide, foodGuideEssentials, foodGuideSources } from '@/lib/frontend/food-pfas-guide';
import { FoodDetails, FoodSourceLink } from './FoodShared';
import './food-evidence.css';
import { HomeResourceFeedback, useHomeResource } from './HomeResource';
import { validPublishedFoodEvidence } from '@/lib/frontend/production/home-resources';

export function PublishedFoodEvidence({ foodId, name, guideId }: FoodEvidenceQuery) {
  const result = useHomeResource('published-food-evidence', { ...(foodId ? { foodId } : {}), ...(guideId ? { guideId } : {}) }, evidenceForFood({ foodId, name, guideId }), validPublishedFoodEvidence);
  const bundle = result.data;
  const [factor, setFactor] = useState<FoodContaminant>(bundle?.studies[0]?.contaminant ?? 'PFAS');
  if (!bundle) return <section className="hg-food-evidence" aria-label="Published food evidence"><header><BookOpen size={21} aria-hidden="true" /><div><span className="hg-kicker">PUBLISHED FINDINGS</span><h3>What testing can tell us</h3></div></header><HomeResourceFeedback {...result} /><p className="hg-meta">No item measurement is inferred while source information is unavailable.</p></section>;
  const studies = bundle.studies.filter(study => study.contaminant === factor);
  const guide = foodGuide(guideId);
  const source = factor === 'Lead' ? foodGuideSources.fdaLead : foodGuideSources[guide?.findingSource ?? 'fdaTesting'];
  return <section className="hg-food-evidence" aria-label="Published food evidence">
    <header><BookOpen size={21} aria-hidden="true" /><div><span className="hg-kicker">PUBLISHED FINDINGS</span><h3>What testing can tell us</h3></div></header>
    <p className="hg-meta">Study results for a food type, not measured levels in your item.</p>
    <div className="hg-evidence-tabs" role="group" aria-label="Food contaminant">{bundle.indicators.map(indicator => <button className="hg-evidence-tab" type="button" key={indicator.contaminant} aria-pressed={factor === indicator.contaminant} onClick={() => setFactor(indicator.contaminant)}><strong>{indicator.contaminant}</strong><span>{indicator.label}</span></button>)}</div>
    <div className="hg-evidence-reading" aria-live="polite">{studies.length ? studies.map(study => <article key={study.id}>
      <span className="hg-meta">{study.source.sampledAt} · {study.analyte}</span><h4>{study.title}</h4>
      <dl className="hg-evidence-metrics">{study.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}<small>{metric.unit}</small></dd></div>)}</dl>
      <p className="hg-evidence-caution">{study.limitation}</p>
      <div className="hg-evidence-next"><strong>A useful next step</strong><p>{study.nextStep}</p></div>
      <FoodDetails title="Sample details and source"><p>{study.finding}</p><p>{study.scopeDetail}</p><dl className="hg-evidence-provenance"><div><dt>Where</dt><dd>{study.sample.region}</dd></div><div><dt>Method</dt><dd>{study.sample.method}</dd></div><div><dt>Units</dt><dd>{study.sample.basis}</dd></div><div><dt>Published</dt><dd>{study.source.publishedAt}</dd></div><div><dt>Source location</dt><dd>{study.source.locator}</dd></div></dl><FoodSourceLink href={study.source.url}>{study.source.title}</FoodSourceLink><FoodSourceLink href={study.source.methodologyUrl}>How the testing was done</FoodSourceLink></FoodDetails>
    </article>) : <div><h4>No reviewed {factor.toLowerCase()} study for this food here yet</h4><p>{factor === 'Lead' ? foodGuideEssentials.lead : guide?.finding ?? foodGuideEssentials.chemicals}</p><FoodSourceLink href={source.url}>{source.title}</FoodSourceLink><p className="hg-evidence-caution">This is broader guidance, not a finding about this food. No data does not mean zero contamination.</p></div>}</div>
    <FoodDetails title="Can HALO estimate my food's levels?"><p>{bundle.boundary}</p><p>A food name cannot reveal its chemical levels. A matching food measurement is needed; HALO does not guess levels or safe serving counts.</p><p>PFAS and lead findings stay separate. Water, soil and nearby readings never become food measurements. Food records never change HALO scores.</p><p className="hg-meta">Evidence reviewed {bundle.reviewedAt}. This is a small reviewed collection, not a complete catalogue of all testing.</p></FoodDetails>
  </section>;
}
