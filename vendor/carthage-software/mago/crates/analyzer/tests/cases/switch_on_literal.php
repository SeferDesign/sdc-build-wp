<?php

/**
 * @mago-expect analysis:always-matching-switch-case
 * @mago-expect analysis:unreachable-switch-default
 * @mago-expect analysis:unreachable-switch-case
 */
function test_switch_on_literal(): string
{
    switch (1) {
        case 1:
            return 'one';
        case 2:
            return 'two';
        default:
            return 'other';
    }
}
