<?php

/**
 * @return 'default'
 *
 * @mago-expect analysis:impossible-condition
 */
function elvis_operator_with_null(): string
{
    $a = null;

    return $a ?: 'default';
}
