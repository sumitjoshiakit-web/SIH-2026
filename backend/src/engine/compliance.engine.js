import { LEGAL_METROLOGY_RULES } from '../rules/legalMetrology.rules.js';

export function evaluateCompliance(text = '') {
  const normalizedText = String(text).replace(/\s+/g, ' ').trim();

  const checks = LEGAL_METROLOGY_RULES.map((rule) => {
    if (rule.visualOnly) {
      return {
        ruleId: rule.id,
        key: rule.key,
        title: rule.title,
        legalBasis: rule.legalBasis,
        status: 'REVIEW',
        evidence: null,
        message:
          'Image/layout verification required; OCR alone cannot prove this requirement.',
        weight: 0,
        visualOnly: true,
      };
    }

    const match = normalizedText.match(rule.pattern);

    if (rule.negative) {
      const passed = !match;

      return {
        ruleId: rule.id,
        key: rule.key,
        title: rule.title,
        legalBasis: rule.legalBasis,
        status: passed ? 'PASS' : 'FAIL',
        evidence: match ? match[0] : null,
        message: passed
          ? 'No misleading quantity wording detected in OCR.'
          : 'Potentially misleading quantity wording detected; manual verification required.',
        weight: rule.weight,
        conditional: Boolean(rule.conditional),
      };
    }

    const status = match ? 'PASS' : 'REVIEW';

    return {
      ruleId: rule.id,
      key: rule.key,
      title: rule.title,
      legalBasis: rule.legalBasis,
      status,
      evidence: match ? match[0] : null,
      message: match
        ? 'Required declaration/pattern detected in OCR.'
        : rule.conditional
          ? 'Conditional requirement not confidently detected; determine applicability and verify manually.'
          : 'Declaration was not confidently detected; manual verification required.',
      weight: rule.weight,
      conditional: Boolean(rule.conditional),
    };
  });

  const scoreChecks = checks.filter(
    (check) => !check.visualOnly && !check.conditional,
  );

  const totalWeight = scoreChecks.reduce(
    (total, check) => total + check.weight,
    0,
  );

  const earnedWeight = scoreChecks.reduce(
    (total, check) => total + (check.status === 'PASS' ? check.weight : 0),
    0,
  );

  const score = totalWeight
    ? Math.round((earnedWeight / totalWeight) * 100)
    : 0;

  const hasHardFailure = checks.some((check) => check.status === 'FAIL');
  const visualReviewRequired = checks.some((check) => check.visualOnly);
  const conditionalReviewRequired = checks.some(
    (check) => check.conditional && check.status !== 'PASS',
  );

  const status =
    hasHardFailure || score < 50
      ? 'POTENTIAL_NON_COMPLIANCE'
      : score >= 85 && !conditionalReviewRequired
        ? 'LIKELY_COMPLIANT'
        : 'NEEDS_REVIEW';

  return {
    score,
    status,
    checks,
    visualReviewRequired,
    conditionalReviewRequired,
  };
}

export function getRuleSummary() {
  return {
    framework:
      'Legal Metrology (Packaged Commodities) Rules, 2011 screening map',
    ruleCount: LEGAL_METROLOGY_RULES.length,
    rules: LEGAL_METROLOGY_RULES.map(({ pattern, ...rule }) => rule),
  };
}
