<?php


/**
 * @return 'hello'
 *
 * @mago-expect analysis:redundant-condition
 */
function short_ternary_with_truthy(): string
{
    $a = 'hello';
    return $a ? : 'default';
}
