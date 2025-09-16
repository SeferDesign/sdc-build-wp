<?php

/**
 * @return 1
 *
 * @mago-expect analysis:redundant-condition
 */
function conditional_always_truthy(): int
{
    return true ? 1 : 2;
}
