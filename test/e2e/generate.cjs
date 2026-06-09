#!/usr/bin/env -S node

const path = require('node:path');
const process = require('node:process');

const { rootNodeFromAnchor } = require('@codama/nodes-from-anchor');
const { readJson } = require('@codama/renderers-core');
const { visit } = require('@codama/visitors-core');

const { renderVisitor } = require('../../dist/index.node.cjs');

async function main() {
    const project = process.argv.slice(2)[0] ?? undefined;
    if (project === undefined) {
        throw new Error('Project name is required.');
    }
    await generateProject(project);
}

// Overrides for the second raydium-launchpad render, so the e2e suite
// covers nameTransformers end-to-end.
const RENAMED_NAME_TRANSFORMERS = {
    programAccountsIdentifierFunction: () => 'identifyAccount',
    programAccountsTypeUnion: () => 'AccountType',
    programEventsIdentifierFunction: () => 'identifyEvent',
    programEventsParsedDataKey: () => 'payload',
    programEventsParsedDiscriminatorKey: () => 'kind',
    programEventsParsedUnionType: () => 'ParsedEvent',
    programEventsParseFunction: () => 'parseEvent',
    programEventsTypeUnion: () => 'EventType',
    programInstructionsIdentifierFunction: () => 'identifyInstruction',
    programInstructionsParsedDiscriminatorKey: () => 'kind',
    programInstructionsParsedUnionType: () => 'ParsedInstruction',
    programInstructionsParseFunction: () => 'parseInstruction',
    programInstructionsTypeUnion: () => 'InstructionType',
};

async function generateProject(project) {
    const packageFolder = path.join(__dirname, project);
    const idl = readJson(path.join(packageFolder, 'idl.json'));
    const node = idl?.metadata?.spec ? rootNodeFromAnchor(idl) : idl;
    const visitor = renderVisitor(packageFolder, { kitImportStrategy: 'rootOnly' });

    await visit(node, visitor);

    if (project === 'raydium-launchpad') {
        const renamedVisitor = renderVisitor(packageFolder, {
            generatedFolder: 'src/generated-renamed',
            kitImportStrategy: 'rootOnly',
            nameTransformers: RENAMED_NAME_TRANSFORMERS,
        });
        await visit(node, renamedVisitor);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
