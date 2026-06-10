import { camelCase, isDataEnum, isNode, TypeNode } from '@codama/nodes';

import { Fragment, fragment, getDocblockFragment, RenderScope, TypeManifest, use } from '../utils';

export function getTypeDecoderFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        docs?: string[];
        manifest: Pick<TypeManifest, 'decoder'>;
        /** Lazily cache the decoder at module level so repeated calls reuse one instance. */
        memoize?: boolean;
        name: string;
        node: TypeNode;
        size: number | null;
    },
): Fragment {
    const { name, node, manifest, nameApi, docs = [], memoize = false } = scope;
    const decoderFunction = nameApi.decoderFunction(name);
    const strictName = nameApi.dataType(name);

    const docblock = getDocblockFragment(docs, true);
    // Fragments are single-use in templates, so mint a fresh one per interpolation site.
    const decoderType = () =>
        use(typeof scope.size === 'number' ? 'type FixedSizeDecoder' : 'type Decoder', 'solanaCodecsCore');
    const useTypeCast = isNode(node, 'enumTypeNode') && isDataEnum(node) && typeof scope.size === 'number';

    const typeCast = useTypeCast ? fragment` as ${decoderType()}<${strictName}>` : '';
    if (memoize) {
        // Lazy `??=` init keeps unused decoders tree-shakable. Deriving the cache name
        // from the resolved function name keeps it unique under custom name transformers.
        const cacheVariable = camelCase(`${decoderFunction}_cache`);
        return fragment`let ${cacheVariable}: ${decoderType()}<${strictName}> | undefined;

${docblock}export function ${decoderFunction}(): ${decoderType()}<${strictName}> {
    return (${cacheVariable} ??= ${manifest.decoder}${typeCast});
}`;
    }
    return fragment`${docblock}export function ${decoderFunction}(): ${decoderType()}<${strictName}> {
    return ${manifest.decoder}${typeCast};
}`;
}
