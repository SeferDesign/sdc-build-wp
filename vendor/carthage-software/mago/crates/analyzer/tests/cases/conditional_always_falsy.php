<?php

/**
 * @return 2
 *
 * @mago-expect analysis:impossible-condition
 */
function conditional_always_falsy(): int
{
    return false ? 1 : 2;
}
