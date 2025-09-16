<?php

/**
 * @return 5
 *
 * @mago-expect analysis:redundant-condition
 */
function conditional_with_assignment(): int
{
    $a = 0;
    return ($a = 5) ? $a : 2;
}
