import {
    camelCase,
    CamelCaseString,
    definedTypeNode,
    getAllAccounts,
    getAllDefinedTypes,
    getAllEvents,
    getAllInstructionsWithSubs,
    getAllPdas,
    getAllPrograms,
    resolveNestedTypeNode,
} from '@codama/nodes';
import { createRenderMap, mergeRenderMaps, RenderMap } from '@codama/renderers-core';
import {
    extendVisitor,
    findProgramNodeFromPath,
    getByteSizeVisitor,
    getResolvedInstructionInputsVisitor,
    LinkableDictionary,
    NodeStack,
    pipe,
    recordLinkablesOnFirstVisitVisitor,
    recordNodeStackVisitor,
    staticVisitor,
    visit,
    Visitor,
} from '@codama/visitors-core';

import {
    getAccountPageFragment,
    getErrorPageFragment,
    getEventFramingFileName,
    getEventFramingPageFragment,
    getEventPageFragment,
    getIndexPageFragment,
    getInstructionPageFragment,
    getPdaPageFragment,
    getProgramAccountsFileName,
    getProgramAccountsPageFragment,
    getProgramEventFraming,
    getProgramEventsFileName,
    getProgramEventsPageFragment,
    getProgramInstructionsFileName,
    getProgramInstructionsPageFragment,
    getProgramPageFragment,
    getProgramPluginPageFragment,
    getRootIndexPageFragment,
    getTypePageFragment,
    hasProgramAccountsPage,
    hasProgramEventsPage,
    hasProgramInstructionsPage,
    hasProgramPluginPage,
} from '../fragments';
import {
    DEFAULT_KIT_IMPORT_STRATEGY,
    DEFAULT_NAME_TRANSFORMERS,
    Fragment,
    getDefinedTypeNodesToExtract,
    getImportFromFactory,
    getNameApi,
    getPageFragment,
    GetRenderMapOptions,
    parseCustomDataOptions,
    RenderScope,
} from '../utils';
import { getTypeManifestVisitor } from './getTypeManifestVisitor';

export function getRenderMapVisitor(
    options: GetRenderMapOptions = {},
): Visitor<
    RenderMap<Fragment>,
    'accountNode' | 'definedTypeNode' | 'eventNode' | 'instructionNode' | 'pdaNode' | 'programNode' | 'rootNode'
> {
    const linkables = new LinkableDictionary();
    const stack = new NodeStack();

    const customAccountData = parseCustomDataOptions(options.customAccountData ?? [], 'AccountData');
    const customInstructionData = parseCustomDataOptions(options.customInstructionData ?? [], 'InstructionData');
    const renderScopeWithTypeManifestVisitor: Omit<RenderScope, 'typeManifestVisitor'> = {
        asyncResolvers: (options.asyncResolvers ?? []).map(camelCase),
        customAccountData,
        customInstructionData,
        dependencyMap: options.dependencyMap ?? {},
        dependencyVersions: options.dependencyVersions ?? {},
        getImportFrom: getImportFromFactory(options.linkOverrides ?? {}, customAccountData, customInstructionData),
        kitImportStrategy: options.kitImportStrategy ?? DEFAULT_KIT_IMPORT_STRATEGY,
        linkables,
        nameApi: getNameApi({ ...DEFAULT_NAME_TRANSFORMERS, ...options.nameTransformers }),
        nonScalarEnums: (options.nonScalarEnums ?? []).map(camelCase),
        renderParentInstructions: options.renderParentInstructions ?? false,
    };

    const typeManifestVisitor = getTypeManifestVisitor({ ...renderScopeWithTypeManifestVisitor, stack });
    const renderScope: RenderScope = { ...renderScopeWithTypeManifestVisitor, typeManifestVisitor };

    const internalNodes = (options.internalNodes ?? []).map(camelCase);
    const resolvedInstructionInputVisitor = getResolvedInstructionInputsVisitor();
    const byteSizeVisitor = getByteSizeVisitor(linkables, { stack });
    const asPage = <TFragment extends Fragment | undefined>(
        fragment: TFragment,
        dependencyMap: Record<string, string> = {},
    ): TFragment => {
        if (!fragment) return undefined as TFragment;
        return getPageFragment(fragment, {
            ...renderScope,
            dependencyMap: { ...renderScope.dependencyMap, ...dependencyMap },
        }) as TFragment;
    };

    return pipe(
        staticVisitor(() => createRenderMap<Fragment>(), {
            keys: [
                'rootNode',
                'programNode',
                'pdaNode',
                'accountNode',
                'definedTypeNode',
                'eventNode',
                'instructionNode',
            ],
        }),
        v =>
            extendVisitor(v, {
                visitAccount(node) {
                    return createRenderMap(
                        `accounts/${camelCase(node.name)}.ts`,
                        asPage(
                            getAccountPageFragment({
                                ...renderScope,
                                accountPath: stack.getPath('accountNode'),
                                size: visit(node, byteSizeVisitor),
                            }),
                        ),
                    );
                },

                visitDefinedType(node) {
                    return createRenderMap(
                        `types/${camelCase(node.name)}.ts`,
                        asPage(getTypePageFragment({ ...renderScope, node, size: visit(node, byteSizeVisitor) }), {
                            generatedTypes: './index',
                        }),
                    );
                },

                visitEvent(node) {
                    const innerType = resolveNestedTypeNode(node.data);
                    const syntheticType = definedTypeNode({ docs: node.docs, name: node.name, type: innerType });
                    const programNode = findProgramNodeFromPath(stack.getPath('eventNode'));
                    return createRenderMap(
                        `events/${camelCase(node.name)}.ts`,
                        asPage(
                            getEventPageFragment({
                                ...renderScope,
                                eventNode: node,
                                programEventFraming: programNode ? getProgramEventFraming(programNode) : undefined,
                                programNode: programNode ?? undefined,
                                size: visit(syntheticType, byteSizeVisitor),
                            }),
                            { generatedEvents: '.' },
                        ),
                    );
                },

                visitInstruction(node) {
                    return createRenderMap(
                        `instructions/${camelCase(node.name)}.ts`,
                        asPage(
                            getInstructionPageFragment({
                                ...renderScope,
                                instructionPath: stack.getPath('instructionNode'),
                                resolvedInputs: visit(node, resolvedInstructionInputVisitor),
                                size: visit(node, byteSizeVisitor),
                            }),
                        ),
                    );
                },

                visitPda(node) {
                    return createRenderMap(
                        `pdas/${camelCase(node.name)}.ts`,
                        asPage(getPdaPageFragment({ ...renderScope, pdaPath: stack.getPath('pdaNode') })),
                    );
                },

                visitProgram(node, { self }) {
                    const customDataDefinedType = [
                        ...getDefinedTypeNodesToExtract(node.accounts, customAccountData),
                        ...getDefinedTypeNodesToExtract(node.instructions, customInstructionData),
                    ];
                    const scope = { ...renderScope, programNode: node };

                    // Hoist the shared event-framing constant (e.g. Anchor's CPI event tag) to its own page.
                    const programEventFraming = getProgramEventFraming(node);
                    const eventFramingPage = programEventFraming
                        ? {
                              [`events/${getEventFramingFileName(programEventFraming.framing)}.ts`]: asPage(
                                  getEventFramingPageFragment({ ...renderScope, programEventFraming }),
                              ),
                          }
                        : {};

                    return mergeRenderMaps([
                        createRenderMap({
                            ...eventFramingPage,
                            // Aggregate identify*/parse* helpers render inside their domain folder
                            // so they can import the per-node pages as siblings.
                            [`accounts/${getProgramAccountsFileName(node)}.ts`]: asPage(
                                getProgramAccountsPageFragment(scope),
                            ),
                            [`events/${getProgramEventsFileName(node)}.ts`]: asPage(
                                getProgramEventsPageFragment(scope),
                            ),
                            [`instructions/${getProgramInstructionsFileName(node)}.ts`]: asPage(
                                getProgramInstructionsPageFragment(scope),
                            ),
                            [`plugins/${camelCase(node.name)}.ts`]: asPage(getProgramPluginPageFragment(scope)),
                            [`programs/${camelCase(node.name)}.ts`]: asPage(getProgramPageFragment(scope)),
                            [`errors/${camelCase(node.name)}.ts`]:
                                node.errors.length > 0 ? asPage(getErrorPageFragment(scope)) : undefined,
                        }),
                        ...node.pdas.map(p => visit(p, self)),
                        ...node.accounts.map(a => visit(a, self)),
                        ...node.definedTypes.map(t => visit(t, self)),
                        ...(node.events ?? []).map(event => visit(event, self)),
                        ...customDataDefinedType.map(t => visit(t, self)),
                        ...getAllInstructionsWithSubs(node, { leavesOnly: !renderScope.renderParentInstructions }).map(
                            i => visit(i, self),
                        ),
                    ]);
                },

                visitRoot(node, { self }) {
                    const isNotInternal = (n: { name: CamelCaseString }) => !internalNodes.includes(n.name);
                    const programsToExport = getAllPrograms(node).filter(isNotInternal);
                    const programsWithErrorsToExport = programsToExport.filter(p => p.errors.length > 0);
                    const pdasToExport = getAllPdas(node);
                    const accountsToExport = getAllAccounts(node).filter(isNotInternal);
                    const instructionsToExport = getAllInstructionsWithSubs(node, {
                        leavesOnly: !renderScope.renderParentInstructions,
                    }).filter(isNotInternal);
                    const definedTypesToExport = getAllDefinedTypes(node).filter(isNotInternal);
                    // program.events may be undefined when no events exist.
                    const eventsToExport = getAllEvents(node).filter(Boolean).filter(isNotInternal);
                    // Framing-constant pages must also be re-exported from the events barrel.
                    const eventFramingFileNames = new Set(
                        getAllPrograms(node)
                            .map(getProgramEventFraming)
                            .filter(framing => framing !== undefined)
                            .map(framing => getEventFramingFileName(framing.framing)),
                    );
                    // Re-export the aggregate identify*/parse* pages from their domain barrels.
                    const accountsIndexItems = [
                        ...accountsToExport,
                        ...programsToExport
                            .filter(hasProgramAccountsPage)
                            .map(program => ({ name: getProgramAccountsFileName(program) })),
                    ];
                    const instructionsIndexItems = [
                        ...instructionsToExport,
                        ...programsToExport
                            .filter(hasProgramInstructionsPage)
                            .map(program => ({ name: getProgramInstructionsFileName(program) })),
                    ];
                    const eventsIndexItems = [
                        ...eventsToExport,
                        ...[...eventFramingFileNames].map(name => ({ name })),
                        ...programsToExport
                            .filter(hasProgramEventsPage)
                            .map(program => ({ name: getProgramEventsFileName(program) })),
                    ];

                    const scope = {
                        ...renderScope,
                        accountsToExport,
                        definedTypesToExport,
                        eventsToExport,
                        instructionsToExport,
                        pdasToExport,
                        programsToExport,
                    };

                    return mergeRenderMaps([
                        createRenderMap({
                            ['accounts/index.ts']: asPage(getIndexPageFragment(accountsIndexItems)),
                            ['errors/index.ts']: asPage(getIndexPageFragment(programsWithErrorsToExport)),
                            ['events/index.ts']: asPage(getIndexPageFragment(eventsIndexItems)),
                            ['index.ts']: asPage(getRootIndexPageFragment(scope)),
                            ['instructions/index.ts']: asPage(getIndexPageFragment(instructionsIndexItems)),
                            ['pdas/index.ts']: asPage(getIndexPageFragment(pdasToExport)),
                            ['plugins/index.ts']: asPage(
                                getIndexPageFragment(programsToExport.filter(hasProgramPluginPage)),
                            ),
                            ['programs/index.ts']: asPage(getIndexPageFragment(programsToExport)),
                            ['types/index.ts']: asPage(getIndexPageFragment(definedTypesToExport)),
                        }),
                        ...getAllPrograms(node).map(p => visit(p, self)),
                    ]);
                },
            }),
        v => recordNodeStackVisitor(v, stack),
        v => recordLinkablesOnFirstVisitVisitor(v, linkables),
    );
}
