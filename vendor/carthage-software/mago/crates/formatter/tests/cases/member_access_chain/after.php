<?php

class Example
{
    public function something(): void
    {
        return $formattedArgumentName
            ->wrap('<style="fg-gray dim">------------</style>', '<style="fg-gray dim">------------</style>')
            ->toString();
    }

    public function something(): void
    {
        return $this->wrap(
            '<style="fg-gray dim">------------</style>',
            '<style="fg-gray dim">------------</style>',
        )->toString();
    }

    public function something(): void
    {
        return $foo->wrap(
            '<style="fg-gray dim">------------</style>',
            '<style="fg-gray dim">------------</style>',
        )->toString();
    }

    public function something(): void
    {
        return Foo->wrap(
            '<style="fg-gray dim">------------</style>',
            '<style="fg-gray dim">------------</style>',
        )->toString();
    }

    public function something(): void
    {
        return Quz\Foo->wrap(
            '<style="fg-gray dim">------------</style>',
            '<style="fg-gray dim">------------</style>',
        )->toString();
    }

    public function something(): void
    {
        return Quz\Foo->wrap(
            '<style="fg-gray dim">------------------------------------</style>',
            '<style="fg-gray dim">------------------------------------</style>',
        )->toString();
    }

    public function something(): void
    {
        return new Bar()
            ->wrap(
                '<style="fg-gray dim">------------------------------------</style>',
                '<style="fg-gray dim">------------------------------------</style>',
            )
            ->toString();
    }

    public function something(): void
    {
        $attribute = $this->matchedRoute
            ->route
            ->handler
            ->getAttribute(Allow::class);
    }

    public function something(): void
    {
        EventLoop::getDriver()->run();
    }

    public function something(): void
    {
        $availableCommands = arr($this->repository->getPendingCommands())
            ->filter(fn(object $command, string $uuid) => !array_key_exists($uuid, $processes));
    }
}

return new CreateTableStatement('permissions')
    ->primary()
    ->varchar('name');

$promise = $downloader
    ->addCopy($download['url'], $downloaded_file)
    ->then(static function (Response $response) use (
        $filesystem,
        $release_dir,
        $downloaded_file,
        $executable_platform_file,
        $executable_platform_content,
    ): Response {
        $phar = new \PharData($downloaded_file);
        $phar->extractTo($release_dir);

        $filesystem->remove($downloaded_file);

        file_put_contents($executable_platform_file, $executable_platform_content);

        return $response;
    });
