// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { ancestorNodeId, isVirtualNode, projectNodeId } from './structure.js';

const PROJECTS = { numberById: { 'demo-web-1': '10000000002' }, idByNumber: { '10000000002': 'demo-web-1' } };

describe('ancestorNodeId', () => {
  it.each([
    ['organizations/30000000001', '//cloudresourcemanager.googleapis.com/organizations/30000000001'],
    ['folders/20000000001', '//cloudresourcemanager.googleapis.com/folders/20000000001'],
    ['projects/10000000002', '//cloudresourcemanager.googleapis.com/projects/10000000002'],
    ['projects/demo-web-1', '//cloudresourcemanager.googleapis.com/projects/10000000002'],
    ['projects/demo-unknown-1', '//cloudresourcemanager.googleapis.com/projects/demo-unknown-1'],
  ])('maps %s to %s', (entry, id) => {
    expect(ancestorNodeId(entry, PROJECTS)).toBe(id);
  });

  it('does not read inherited properties of the index', () => {
    expect(ancestorNodeId('projects/constructor', PROJECTS)).toBe(
      '//cloudresourcemanager.googleapis.com/projects/constructor',
    );
  });
});

describe('node ids', () => {
  it('names project nodes by number and recognises virtual nodes', () => {
    expect(projectNodeId('10000000002')).toBe('//cloudresourcemanager.googleapis.com/projects/10000000002');
    expect(isVirtualNode('//gcportrait.virtual/projects/p/locations/europe-west3')).toBe(true);
    expect(isVirtualNode('//compute.googleapis.com/projects/p/global/networks/n')).toBe(false);
  });
});
