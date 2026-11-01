// Protects the rules of the method forms of the OpenCode Settings tab: `when` decides only what is
// SHOWN, a hidden field never reaches the answer, and a required visible one blocks the button.
// Provenance: the fields are fabricated from the shapes of `settingsProtocol.ts` and the copilot
// form of the planner spike (opencode 2.0.32, 01/11/2026); no real server was involved.
import { describe, expect, it } from 'vitest';
import type { SettingsFieldRow } from '../../../src/shared/settingsProtocol';
import {
  buildAnswer,
  initialValues,
  isFieldVisible,
  missingRequired,
  visibleFields,
} from './formWhen';

const fields: SettingsFieldRow[] = [
  {
    key: 'deploymentType',
    required: true,
    options: [
      { value: 'github.com', label: 'GitHub.com' },
      { value: 'enterprise', label: 'Enterprise' },
    ],
  },
  {
    key: 'enterpriseUrl',
    required: true,
    when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
  },
  {
    key: 'note',
    required: false,
    when: [{ key: 'deploymentType', op: 'neq', value: 'enterprise' }],
  },
];

describe('isFieldVisible', () => {
  it('shows a field without `when` and evaluates eq and neq on the whole string', () => {
    expect(isFieldVisible(fields[0] as SettingsFieldRow, {})).toBe(true);
    expect(isFieldVisible(fields[1] as SettingsFieldRow, { deploymentType: 'enterprise' })).toBe(
      true,
    );
    expect(isFieldVisible(fields[1] as SettingsFieldRow, { deploymentType: 'enterprise2' })).toBe(
      false,
    );
    expect(isFieldVisible(fields[2] as SettingsFieldRow, { deploymentType: 'github.com' })).toBe(
      true,
    );
    expect(isFieldVisible(fields[2] as SettingsFieldRow, { deploymentType: 'enterprise' })).toBe(
      false,
    );
  });

  it('treats an absent key as the empty string and requires every condition', () => {
    const both: SettingsFieldRow = {
      key: 'x',
      required: false,
      when: [
        { key: 'a', op: 'eq', value: '1' },
        { key: 'b', op: 'neq', value: '' },
      ],
    };
    expect(isFieldVisible(both, { a: '1' })).toBe(false);
    expect(isFieldVisible(both, { a: '1', b: 'z' })).toBe(true);
  });
});

describe('answers', () => {
  it('leaves hidden fields out of the answer even if they hold a value', () => {
    const values = { deploymentType: 'github.com', enterpriseUrl: 'https://old.example' };
    expect(visibleFields(fields, values).map((f) => f.key)).toEqual(['deploymentType', 'note']);
    expect(buildAnswer(fields, values)).toEqual({ deploymentType: 'github.com' });
  });

  it('reports only visible required fields that are empty or blank', () => {
    expect(
      missingRequired(fields, { deploymentType: 'enterprise', enterpriseUrl: '  ' }).map(
        (f) => f.key,
      ),
    ).toEqual(['enterpriseUrl']);
    expect(missingRequired(fields, { deploymentType: 'github.com' })).toEqual([]);
  });

  it('starts from the draft, then the default, then the first option of a required select', () => {
    const withDefault: SettingsFieldRow = { key: 'region', required: false, default: 'eu' };
    expect(initialValues([...fields, withDefault], {})).toEqual({
      deploymentType: 'github.com',
      enterpriseUrl: '',
      note: '',
      region: 'eu',
    });
    expect(initialValues(fields, { deploymentType: 'enterprise' }).deploymentType).toBe(
      'enterprise',
    );
  });
});
