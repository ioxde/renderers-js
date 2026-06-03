#!/usr/bin/env bash
set -eux

VALIDATOR_PID=""

function cleanup() {
    if [ -n "$VALIDATOR_PID" ]; then
        kill "$VALIDATOR_PID" 2>/dev/null || true
        wait "$VALIDATOR_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

function check_validator() {
    curl -s http://127.0.0.1:8899 -X POST \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
        2>/dev/null | grep -q '"ok"'
}

function start_validator() {
    if check_validator; then
        echo "Using existing validator on port 8899"
        return 0
    fi
    solana-test-validator --reset >/dev/null 2>&1 &
    VALIDATOR_PID=$!

    local retries=30
    while [ $retries -gt 0 ]; do
        if check_validator; then
            return 0
        fi
        retries=$((retries - 1))
        sleep 1
    done
    echo "Validator failed to start"
    exit 1
}

function lint_generated() {
    node --input-type=module -e "
import { ESLint } from 'eslint';
import importPlugin from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { 'import-x': importPlugin },
        rules: { 'import-x/extensions': ['error', 'always', { ignorePackages: true }] },
    }],
});

const results = await eslint.lintFiles('test/e2e/$1/src/generated/**/*.ts');
const formatter = await eslint.loadFormatter('stylish');
const text = await formatter.format(results);
if (text) console.log(text);
if (results.some(r => r.errorCount > 0)) process.exit(1);
"
}

function test_project() {
    ./test/e2e/generate.cjs $1
    lint_generated $1
    cd test/e2e/$1
    pnpm install && pnpm build && pnpm test
    cd ../../..
}

start_validator
test_project anchor
test_project raydium-cpmm
test_project raydium-launchpad
test_project system
test_project memo
test_project token
test_project dummy
