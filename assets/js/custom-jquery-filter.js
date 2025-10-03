$(document).ready(function(){

	$('#filer_input').filer({
		showThumbs: true,
		addMore: true,
		allowDuplicates: false
	});

	$('#filer_quote_input').filer({
		fileMaxSize:5,
		extensions:null,
		showThumbs: true,
		addMore: true,
		allowDuplicates: false,
		errors: {
				filesLimit: "Only {{fi-limit}} files are allowed to be uploaded.",
				filesType: "Only {{fi-extension}} are allowed to be uploaded.",
				filesSize: "{{fi-name}} is too large! Please upload file up to {{fi-fileMaxSize}} MB.",
				filesSizeAll: "Files you've choosed are too large! Please upload files up to {{fi-maxSize}} MB.",
				folderUpload: "You are not allowed to upload folders."
		}
	});

	$('#filer_input_leads').filer({
		showThumbs: true,
		addMore: true,
		allowDuplicates: false
	});

    $('#filer_input_leads').prop('id', 'filer_input_lead');
    
    $('#file_attachments').filer({
		fileMaxSize:5,
		extensions:null,
		showThumbs: true,
		addMore: true,
		allowDuplicates: false,
		errors: {
				filesLimit: "Only {{fi-limit}} files are allowed to be uploaded.",
				filesType: "Only {{fi-extension}} are allowed to be uploaded.",
				filesSize: "{{fi-name}} is too large! Please upload file up to {{fi-fileMaxSize}} MB.",
				filesSizeAll: "Files you've choosed are too large! Please upload files up to {{fi-maxSize}} MB.",
				folderUpload: "You are not allowed to upload folders."
		}
	});


});

