<?php

/**
 * @mago-expect analysis:unreachable-switch-case
 */
function test_switch_case_after_default_is_unreachable(int $value): string {
    switch ($value) {
        case 1:
            return 'one';
        default:
            return 'default';
        case 2:
            return 'two';
    }
}
