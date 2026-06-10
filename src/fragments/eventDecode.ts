import { camelCase, EventNode, isNode, isNodeFilter } from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getDiscriminatorConstantName } from './discriminatorConstants';
import {
    getCpiFramedSkipExprFragment,
    getEventCpiFraming,
    getEventFramingConstantFragment,
    getEventFramingFileName,
    ResolvedProgramEventFraming,
} from './eventFraming';

export function getEventDecodeFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        eventNode: EventNode;
        programEventFraming?: ResolvedProgramEventFraming;
    },
): Fragment {
    const { eventNode, nameApi, programEventFraming } = scope;
    const cpiFraming = getEventCpiFraming(eventNode, programEventFraming);
    const allDiscriminators = eventNode.discriminators ?? [];
    // The framing discriminator is validated via the shared hoisted constant, so drop it here.
    const discriminators = cpiFraming ? allDiscriminators.slice(1) : allDiscriminators;
    const constantDiscs = discriminators.filter(isNodeFilter('constantDiscriminatorNode'));

    const framingConstant = cpiFraming
        ? getEventFramingConstantFragment(
              cpiFraming.framing,
              nameApi,
              `./${getEventFramingFileName(cpiFraming.framing)}`,
          )
        : undefined;

    const containsBytes = use('containsBytes', 'solanaCodecsCore');
    const framingCheck = framingConstant
        ? [
              fragment`if (!${containsBytes}(data, ${framingConstant}, 0)) {
    throw new Error('Invalid event CPI framing for ${eventNode.name}');
  }`,
          ]
        : [];
    const constantNames = constantDiscs.map(disc =>
        nameApi.constant(getDiscriminatorConstantName(eventNode.name, disc, discriminators)),
    );
    const validationChecks = mergeFragments(
        [
            ...framingCheck,
            ...constantDiscs.map((disc, index) => {
                const constant = constantNames[index];
                const offset = disc.offset ?? 0;
                return fragment`if (!${containsBytes}(data, ${constant}, ${offset})) {
    throw new Error('Invalid event discriminator for ${eventNode.name}');
  }`;
            }),
        ],
        c => c.join('\n  '),
    );

    const decodeFunction = nameApi.eventDecodeFunction(eventNode.name);
    const strictType = nameApi.dataType(eventNode.name);
    const decoderFunction = nameApi.decoderFunction(eventNode.name);

    let skipExpr: Fragment;
    if (cpiFraming) {
        skipExpr = getCpiFramedSkipExprFragment({
            discriminators,
            eventName: eventNode.name,
            nameApi,
            programEventFraming: cpiFraming,
        });
    } else if (isNode(eventNode.data, 'hiddenPrefixTypeNode') && eventNode.data.prefix.length === 1) {
        const firstDiscConstant = nameApi.constant(camelCase(`${eventNode.name}_discriminator`));
        skipExpr = fragment`${firstDiscConstant}.length`;
    } else if (isNode(eventNode.data, 'hiddenPrefixTypeNode')) {
        const totalSize = eventNode.data.prefix.reduce(
            (sum, p) => sum + (isNode(p.type, 'fixedSizeTypeNode') ? p.type.size : 0),
            0,
        );
        skipExpr = fragment`${String(totalSize)}`;
    } else {
        throw new Error(`Unexpected event data type for ${eventNode.name}`);
    }

    return fragment`export function ${decodeFunction}(data: ${use('type ReadonlyUint8Array', 'solanaCodecsCore')}): ${strictType} {
  ${validationChecks}
  return ${decoderFunction}().decode(data, ${skipExpr});
}`;
}
