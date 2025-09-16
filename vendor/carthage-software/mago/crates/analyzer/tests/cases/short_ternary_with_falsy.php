<?php

/**
 * @return 'default'
 *
 * @mago-expect analysis:impossible-condition
 */
function short_ternary_with_falsy(): string
{
    $a = '';
    return $a ? : 'default';
}
