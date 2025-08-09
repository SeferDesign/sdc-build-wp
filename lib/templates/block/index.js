import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';

import metadata from './block.json';

// import './style.scss';
// import './editor.scss';

registerBlockType(metadata.name, {
	edit: ({ attributes, setAttributes }) => {
		const blockProps = useBlockProps();
		return (
			<div { ...blockProps }><em>Placeholder for {metadata.title}</em></div>
		);
	},
	save: ({ attributes }) => {
		return null;
	},
});
