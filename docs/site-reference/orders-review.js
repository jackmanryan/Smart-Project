
function addNewLine_ShipmentSources() {
    var count_elements = $('.shipmentSources_line').length;
    count_elements++;
    $("#shipmentSources").append("<tr class='gradeX shipmentSources_line' id='source_" + count_elements + "'><input type='hidden' name='shipmentId[]' value='' /><td><select class='form-control' name='shipmentSource[]' class='shipmentSources_selectField'><option value='' >----</option><?php echo $inventorySources_optionLines; ?></select></td><td><textarea class='form-control' rows='3'></textarea></td></tr>");
    return false;
}

function addNewLine_Notes() {
    var count_elements = $('.Notes_line').length;
    count_elements++;
    $("#Notes").append("<tr><input type='hidden' name='noteID[]' value='' /><th><textarea class='form-control noteDescription' name='noteDescription[]' rows='3'></textarea></th><th><?php echo Session::r('name'); ?></th><th><?php echo date('Y-m-d'); ?></th></tr>");
    return false;
}
function removeLine_Notifications(position) {
    $(".Notifications_line").each(function (index) {
        if ((index + 1) == position) {
            $(this).remove();
        }
    });
    return false;
}

function checkEmailNotifications() {
    var getAll = [];
    var countera = 0;
    $("input[name='notification_email[]']").each(function (index) {
        getAll[countera] = $(this).val();
        countera++;
    });

    var typeE = 1;
    var haveRichmond = 0;
    var have3prty = 0;
    $(".shipmentSources_selectField").each(function (index) {
        if ($(this).val() != "") {
            if ($(this).val() == "Richmond Warehouse") {
                if ($.inArray("jennifer@strip-curtains.com", getAll) != -1) {
                    haveRichmond = 1;
                } else {
                    addNewEmailLine_Set("jennifer@strip-curtains.com");
                }
            } else {
                if ($.inArray("angela@strip-curtains.com", getAll) != -1) {
                    have3prty = 1;
                } else {
                    addNewEmailLine_Set("angela@strip-curtains.com");
                }
            }
        }
    });

}

function addNewEmailLine_Set(emailto) {
    var count_elements = $('.Notifications_line').length;
    count_elements++;
    $("#Notifications").append("<tr class='gradeX Notifications_line' id='Notifications_line_" + count_elements + "'><td><input type='checkbox' name='notification[]' value='1' checked></td><td><input type='text' class='form-control' name='notification_email[]' value='" + emailto + "' /></td><td><button type='button' class='btn btn-danger btn-circle' onclick='return removeLine_Notifications(" + count_elements + ");'><i class='fa fa-times-circle'></i></button></td></tr>");
    return false;
}

function validateForm() {
    //Remove current errors printed

    // checkCustomerAccount();
    $('#printErrors').attr('style', 'display:none');
    $('#printErrors_show').html(' ');

    var formData = new FormData();
    formData.append("sales_id", orderid_cp);

    $.ajax({
        url: "ajax/sales/validate_review_breakdown.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false

    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            $("#inputPartHandling").val(updatedContent.InputPartHandling);
            getSourceComment(orderid_cp);
            getShipmentDescription(orderid_cp);

            doExtraChecking();
        } else {
            var str = updatedContent.description;
            var btn1 = '<button class="btn" onClick="yes(event)" style="margin-right:10px;width:50px">Yes</button>';
            var btn2 = '<button class="btn" onClick="no(event)" style="width:50px">No</button>';
            $('#printErrors').attr('style', '');
            $('#printErrors_show').html(updatedContent.description);

            // if (str.indexOf("Order") != -1) {
            //     $('#printErrors_show2').html(btn1 + btn2);
            //     console.log(123);
            // }

            $('#savechanges').html("Save Changes");
        }
    });
}
function yes(event, checked) {
    event.preventDefault();
    $('#printErrors').attr('style', 'display:none');
    $('#printErrors_show').html(' ');
    $('#rereviewed').attr('value', 1);
    var formData = new FormData();
    formData.append("sales_id", orderid_cp);
    formData.append("checked", checked);
    formData.append("reviewed", "reviewed");
    $.ajax({
        url: "ajax/sales/validate_review_breakdown.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false

    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            $("#inputPartHandling").val(updatedContent.InputPartHandling);
            getSourceComment(orderid_cp);
            getShipmentDescription(orderid_cp);

            doExtraChecking();
            // console.log(data);
        } else {
            var str = updatedContent.description;
            $('#printErrors').attr('style', '');
            $('#printErrors_show').html(updatedContent.description);
            // if (str.indexOf("Order") != -1) {
            //     console.log(789);
            //     $('#printErrors_show2').html('');
            // }
            $('#savechanges').html("Save Changes");
        }
    });
}
function no(event) {
    event.preventDefault();
    $('#printErrors').attr('style', 'display:none');
}
function doExtraChecking() {
    /*
    if (parts == null) {
        error += '- All products must be defined first;<br />';
    }
    else {

        $('#inputPartHandling').val(JSON.stringify(parts));

        var commentsToSend = {};
        for (var attrname in selectedSources) {
            commentsToSend[attrname] = selectedSources[attrname];
        }
        for (var attrname in extraComments) {
            commentsToSend[attrname] = extraComments[attrname];
        }


        $('#inputSourceComment').val(JSON.stringify(commentsToSend));

        var mountSrcs = function (e) {
            e.input.val(
                'Source (' + e.id + '): \n' +
                parts
                    .filter(function (p) {
                        return e.id == p.source;
                    })
                    .map(function (p) {
                        return p.completeAmountStr() + ' of "' + p.sku + '"';
                    })
                    .join("\n")
            )
        }
        Object.keys(selectedSources).forEach(function (k) {
            var e = selectedSources[k];
            mountSrcs(e);
        });
        Object.keys(extraComments).forEach(function (k) {

            var e = extraComments[k];
            mountSrcs(e);
        });
    }

    if (parts.find(function (e) {
            return !e.source;
        })) {
        error += '- You must specify the source for each component;<br />';
        $('.sourceCombo').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {

        $('.sourceCombo').attr('style', '');
    }


    if (parts.find(function (e) {
            return e.amount() == 0;
        })) {
        error += '- The amount of material must be specified;<br />';
        $('.material_amount_field[value=0]').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {

        $('.material_amount_field').attr('style', '');
    }
    */
    var error = '';

    //Check if Shipping Contact Name is complete
    if ($('#checkpaymentmethod').val() == 'on_account' && $('#po_number').val() == '') {
        error += '- PO # must be filled when order is On Account;<br />';
        $('#po_number').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {
        $('#po_number').attr('style', '');
    }

    //Check if Shipping Contact Name is complete
    if ($('#shipping_firstname').val() == '') {
        error += '- Shipping first name is empty;<br />';
        $('#shipping_firstname').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {
        $('#shipping_firstname').attr('style', '');
    }

    //Check if Shipping Address is complete
    if ($('#shipping_address1').val() == '') {
        error += '- Shipping address is empty;<br />';
        $('#shipping_address1').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {
        $('#shipping_address1').attr('style', '');
    }

    //Check if Shipping City is complete
    if ($('#shipping_city').val() == '') {
        error += '- Shipping city is empty;<br />';
        $('#shipping_city').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {
        $('#shipping_city').attr('style', '');
    }

    //Check if Shipping State is complete
    if ($('#shipping_state').val() == '') {
        error += '- Shipping state is empty;<br />';
        $('#shipping_state').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {
        $('#shipping_state').attr('style', '');
    }

    //Check if Shipment Type was selected
    if ($("#pick_up").is(':checked')) {

    } else {
        if ($('#shipment_type').val() == '') {
            error += '- You must select a shipment type;<br />';
            $('#shipment_type').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
        } else {
            $('#shipment_type').attr('style', '');
        }
    }


    //Check if Shipping Zip Code is complete
    if ($('#shipping_zipcode').val() == '') {
        error += '- Shipping zip code is empty;<br />';
        $('#shipping_zipcode').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {
        $('#shipping_zipcode').attr('style', '');
    }

    //Check if sage_sales_number is not empty
    /*
    if ($('#sage_sales_number').val() == '') {
        error += '- Sage Invoice Number is empty;<br />';
        $('#sage_sales_number').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
    } else {

        var dados = {'n': $('#sage_sales_number').val()};

        $.get('ajax/checkInvoiceNumber.php', dados).done(function (data) {
            if (data == "invalid") {
                error += '- Sage Invoice Number is invalid/duplicated;<br />';
                $('#sage_sales_number').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
            } else {
                $('#sage_sales_number').attr('style', '');
            }
        });

    }
    */

    //Check Shipment options
    /*
    var shipmentDescription = "";
    $(".shipmentDescription").each(function (index) {
        shipmentDescription += $(this).val();
    });
    if (shipmentDescription == "") {
        $('.shipmentDescription').attr('style', 'border:1px solid #FF0033 !important; background:#FFFF99;');
        error += '- You must enter at least one Shipment Source;<br />';
    }
    */

    $('#savechanges').html("<i class='fa fa-eye'></i> Hold on... Validating data...");

    setTimeout(function () {
        if (error != "") {
            $('#printErrors').attr('style', '');
            $('#printErrors_show').html(error);
            $('#savechanges').html("Save Changes");
        } else {
            $('#printErrors').attr('style', 'display:none');
            $('#printErrors_show').html(' ');
            $('#reviewSale').submit();
        }
    }, 2000);
}


function removePackage(package_id) {

    var formData = new FormData();
    formData.append('sales_id', review);
    formData.append('package_id', package_id);

    $.ajax({
        url: "ajax/sales/removePackages.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false

    }).done(function (data) {
        var updatedContent = $.parseJSON(data);

        if (updatedContent.type == "error") {

            $('#errorMSGPackages').html('<span style="color:#CC0000; font-weight:bold;">ERROR: ' + updatedContent.description + '</span>');
        }
        if (updatedContent.type == "success") {

            $('#packageline-' + package_id).remove();

        }

    });

}

function enableButton(id) {
    var value = $("#inventory_source_" + id).val();

    if (value != "") {
        $('#addNew_' + id).prop('disabled', false);
    } else {
        $('#addNew_' + id).prop('disabled', true);
    }
}

$('#richmondForAll').click(function (e) {
    var selectedSource = $("#inventorySources").val();
    var count = 0;
    $.each($(".sourceCombo"), function () {
        $(this).val(selectedSource).prop('selected', true);

        var value = $(this).val();
        var columnName = "source_name";
        var elid = $(this).attr('id');
        var id = elid.split("_");
        id = id.pop();

        updateRow(id, columnName, value);
        enableButton(id);

        count++;
    });

    updateShipmentComments();

});

function updateShipmentComments() {
    var selectValues = [];
    $('.sourceCombo').each(function (i, obj) {
        var value = ($(obj).val()).replace(/ /g, "_");

        if (value != "") {
            sourceArray[value] = (typeof $("#source_" + value).val() == 'undefined') ? "" : $("#source_" + value).val();
        }

        selectValues.push(value);
    });

    $("#shipmentSourcesBody").empty();
    for (key in sourceArray) {
        var value = sourceArray[key];

        if (selectValues.indexOf(key) > -1) {
            $("#shipmentSourcesBody").append("<tr class='gradeX shipmentSources_line'><input type='hidden' name='shipmentId[]' value='' /><td>" + (key).replace(/_/g, " ") + "</td><td><textarea class='form-control' onblur='updateShipmentComments()' id='source_" + key + "' rows='3'>" + value + "</textarea></td></tr>");
        }
    }

}

function getSourceComment(sales_id) {
    var formData = new FormData();
    formData.append("sales_id", sales_id);
    formData.append("sourceArray", JSON.stringify(sourceArray));

    $.ajax({
        url: "ajax/sales/generate_source_comment.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false
    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            $("#inputSourceComment").val(updatedContent.inputSourceComment);
        }
    });
}

function getShipmentDescription(sales_id) {
    var formData = new FormData();
    formData.append("sales_id", sales_id);

    $.ajax({
        url: "ajax/sales/generate_shipment_description.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false
    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            $("#shipmentDescription").val(updatedContent.shipmentDescription);
        }
    });
}

function addNewRow(id) {
    var formData = new FormData();
    formData.append('id', id);

    $.ajax({
        url: "ajax/sales/review_add_new_row.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false
    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            var package = updatedContent.splitPackage;
            var productPart = updatedContent.productPart;
            var inventorySource = updatedContent.inventorySource;
            var parentPackage = updatedContent.parentPackage;
            var boxCount = updatedContent.boxCount;

            var defaultFunction = "";
            var value = "";
            var totalValue = "";
            var category = "";
            var totalCategory = "";

            $("#totalBoxes").html(boxCount);
            if (package.type == "Linear_FT") {
                defaultFunction = "changeAmount";
                value = package.total;
                totalValue = parseFloat(package.total).toFixed(2);
                category = "ft";
                totalCategory = "ft";
            } else if (package.type == "Strip_Qty") {
                defaultFunction = "changeQty";
                value = package.qty;
                totalValue = parseFloat(package.total).toFixed(2) + " ft (" + (parseFloat(package.total).toFixed(2) * 12) + " in.)";
                category = "strips @ " + parseFloat(package.amount).toFixed(2) + package.unit + " (" + (parseFloat(package.amount) * 12).toFixed(2) + " in.)";
                totalCategory = "";
            } else if (package.type == "Qty") {
                defaultFunction = "changeQty";
                value = package.qty;
                totalValue = parseFloat(package.qty).toFixed(2);
                category = "unit";
                totalCategory = "unit";
            }

            var selectHTML = "<select class='form-control sourceCombo review_fields' id='inventory_source_" + package.id + "' onchange='updateInventorySource(" + package.id + ",0)'" +
                "<option value></option>";
            for (var i = 0; i < inventorySource.length; i++) {
                var source = inventorySource[i];
                var selected = "";
                if (package.source_name == source.source) {
                    selected = "selected";
                }
                selectHTML += "<option value='" + source.source + "' " + selected + ">" + source.source + "</option>"
            }

            var html = "<tr class='row_" + package.id + " warning'> " +
                "<td>" +
                "<input type='hidden' id='id_" + updatedContent.count + "' value='" + package.id + "'>" +
                "<input name='SendProduction[]' class='review_fields' id='production_" + updatedContent.count + "' type='checkbox' value='1' checked='' onchange='updateSendToProduction(" + package.id + "," + updatedContent.count + ")'>" +
                "</td>" +
                "<td>" +
                "<input type='text' name='fitInBoxNumber[]'  id='box_number_" + package.id + "' class='boxNumber form-group input-group review_fields' style='width:50px; text-align:center; ' value='0' onchange='updateBoxNumber(" + package.id + "," + updatedContent.count + "," + package.sales_id + ")'>" +
                "</td>" +
                "<td>" +
                package.sku +
                "</td>" +
                "<td>" +
                "<div class='form-group input-group' style='margin-bottom: 0'>" +
                "<input class='form-control material_amount_field' id='qty_" + package.id + "' type='number' value='" + value + "' onchange='" + defaultFunction + "(" + package.id + ")'>" +
                "<span class='input-group-addon'>" + category + "</span>" +
                "</div>" +
                "</td>" +
                "<td>" +
                "<span id='total_" + package.id + "'>" + totalValue + "</span> " +
                totalCategory +
                "</td>" +
                "<td>" +
                "$<span id='price_" + package.id + "'>" + "0" + "</span> " +
                "</td>" +
                "<td>" +
                "<span id='weight_" + package.id + "'>" + "0 lbs" + "</span> " +
                "</td>" +
                "<td>" +
                selectHTML +
                "</td>" +
                "<td>" +
                "<button type='button' id='addNew_" + package.id + "' class='addNew btn btn-circle btn-warning' onclick='deleteRow(" + package.id + ")' >" +
                "<i class='fa fa-plus-circle'></i>" +
                "</button>" +
                "</td>" +
                "</tr>";
            $('.row_' + id).last().after(html);
        }
    });
}

function updateBoxNumber(id, count, sales_id) {
    var value = $("#box_number_" + id).val();
    var columnName = "boxnumber";
    updateRow(id, columnName, value);

    updateShippingBox(sales_id);
}

function changeQty(id) {
    var value = $("#qty_" + id).val();
    var columnName = "qty_update_parent";
    updateRow(id, columnName, value);
}

function changeAmount(id) {
    var value = $("#qty_" + id).val();
    var columnName = "amount_update_parent";
    updateRow(id, columnName, value);
}

function updateSendToProduction(id, count) {
    if (document.getElementById("production_" + count).checked) {
        value = 1;
    } else {
        value = 0;
    }
    var columnName = "send_to_production";
    updateRow(id, columnName, value);
}

var sourceArray = {};
function updateInventorySource(id, count) {
    var value = $("#inventory_source_" + id).val();
    var columnName = "source_name";
    updateRow(id, columnName, value);
    enableButton(id);

    updateShipmentComments();
}
function updateShippingBox(id) {
    var formData = new FormData();
    formData.append('id', id);
    $.ajax({
        url: "ajax/box/update_shipping_box.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false
    }).done(function (data) {
        // console.log(data);
        // $("#ShippingBox").html(data);	
    });
}

function updateRow(id, columnName, value) {
    var formData = new FormData();
    formData.append("id", id);
    formData.append("columnName", columnName);
    formData.append("value", value);

    $.ajax({
        url: "ajax/sales/update_review_breakdown.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false

    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            var parentBreakdown = updatedContent.parentBreakdown;
            var breakdown = updatedContent.breakdown;
            var productPart = updatedContent.productPart;
            var boxCount = updatedContent.boxCount;
            var po_array = updatedContent.po_array;
            var source_list = updatedContent.source_list;

            var childQtyValue = "";
            var childTotalValue = "";
            var parentQtyValue = "";
            var parentTotalValue = "";
            var childWeightValue = "";
            var parentWeightValue = "";
            var childTotalPrice = 0;
            var parentTotalPrice = 0;

            $("#totalBoxes").html(boxCount);

            if (breakdown.type == "Linear_FT") {
                if (breakdown != null) {
                    childQtyValue = parseFloat(breakdown.total).toFixed(2);
                    childTotalValue = parseFloat(breakdown.total).toFixed(2);
                    childWeightValue = productPart.lb_per_unit + " lbs/ea (" + parseFloat(breakdown.total * productPart.lb_per_unit).toFixed(2) + " lbs)";
                    childTotalPrice = parseFloat(breakdown.total * productPart.price).toFixed(2);
                }

                if (parentBreakdown != null) {
                    parentQtyValue = parseFloat(parentBreakdown.total).toFixed(2);
                    parentTotalValue = parseFloat(parentBreakdown.total).toFixed(2);
                    parentWeightValue = productPart.lb_per_unit + " lbs/ea (" + parseFloat(parentBreakdown.total * productPart.lb_per_unit).toFixed(2) + " lbs)";
                    parentTotalPrice = parseFloat(parentBreakdown.total * productPart.price).toFixed(2);
                }
            } else if (breakdown.type == "Strip_Qty") {
                if (breakdown != null) {
                    childQtyValue = parseFloat(breakdown.qty).toFixed(2);
                    childTotalValue = parseFloat(breakdown.total).toFixed(2) + " ft (" + parseFloat(breakdown.total * 12).toFixed(2) + " in.)";
                    childWeightValue = productPart.lb_per_unit + " lbs/ea (" + parseFloat(breakdown.total * productPart.lb_per_unit).toFixed(2) + " lbs)";
                    childTotalPrice = parseFloat(breakdown.total * productPart.price).toFixed(2);
                }

                if (parentBreakdown != null) {
                    parentQtyValue = parseFloat(parentBreakdown.qty).toFixed(2);
                    parentTotalValue = parseFloat(parentBreakdown.total).toFixed(2) + " ft (" + parseFloat(parentBreakdown.total * 12).toFixed(2) + " in.)";
                    parentWeightValue = productPart.lb_per_unit + " lbs/ea (" + parseFloat(parentBreakdown.total * productPart.lb_per_unit).toFixed(2) + " lbs)";
                    parentTotalPrice = parseFloat(parentBreakdown.total * productPart.price).toFixed(2);
                }
            } else if (breakdown.type == "Qty") {
                if (breakdown != null) {
                    childQtyValue = parseFloat(breakdown.qty).toFixed(2);
                    childTotalValue = parseFloat(breakdown.qty).toFixed(2);
                    childWeightValue = productPart.lb_per_unit + " lbs/ea (" + parseFloat(breakdown.total * productPart.lb_per_unit).toFixed(2) + " lbs)";
                    childTotalPrice = parseFloat(breakdown.qty * productPart.price).toFixed(2);
                }

                if (parentBreakdown != null) {
                    parentQtyValue = parseFloat(parentBreakdown.qty).toFixed(2);
                    parentTotalValue = parseFloat(parentBreakdown.qty).toFixed(2);
                    parentWeightValue = productPart.lb_per_unit + " lbs/ea (" + parseFloat(parentBreakdown.total * productPart.lb_per_unit).toFixed(2) + " lbs)";
                    parentTotalPrice = parseFloat(parentBreakdown.qty * productPart.price).toFixed(2);
                }
            }


            if (breakdown != null) {
                $("#qty_" + breakdown.id).text(childQtyValue);
                $("#total_" + breakdown.id).text(childTotalValue);
                $("#weight_" + breakdown.id).text(childWeightValue);
                $("#price_" + breakdown.id).text(childTotalPrice);

            }

            if (parentBreakdown != null) {
                $("#qty_" + parentBreakdown.id).text(parentQtyValue);
                $("#total_" + parentBreakdown.id).text(parentTotalValue);
                $("#weight_" + parentBreakdown.id).text(parentWeightValue);
                $("#price_" + parentBreakdown.id).text(parentTotalPrice);
            }
            if (po_array != null) {
                $('#poTable').empty();
                var total = 0.00;
                $.each(po_array, function (index, value) {

                    total += +parseFloat(value.price).toFixed(2);
                    var val = value.sku;
                    if (val.indexOf("WD-") != '-1') {
                        var input = '<textarea name="curtain" id="curtain_description" rows="5" style="width: 100%;" onKeyup="changeQuantity(this,' + value.sales_id + ')">' + value.description + '</textarea>'
                    }
                    else {
                        var input = '<input id="cut_length" class="form-control" type="text" value="' + value.cut_length + '"  style="width: 55%;" onKeyup="changeQuantity(this,' + value.sales_id + ')">';
                    }
                    if (value.unit_price > 0) {
                        var readonly = 'readonly';
                    }
                    else {
                        var readonly = '';
                    }
                    if (value.price > 0) {
                        var readonly1 = 'readonly';
                    }
                    else {
                        var readonly1 = '';
                    }
                    if (value.amount > 0) {
                        var readonly2 = 'readonly';
                    }
                    else {
                        var readonly2 = '';
                    }
                    var onclick = '<button class="btn btn-info" onClick="deleteCuttingCharge(event, this, ' + value.sales_id + ')"> <i class="fa fa-times"></i> Delete</button>';
                    var td = '<td>' + value.sku + '</td><td><input class="form-control" id="quantity" type="text" onKeyup="changeQuantity(this,' + value.sales_id + ')" value="' + value.amount + '"  style="width: 55%;"></td><td>' + input + '</td><td><input class="form-control" id="unit_price" type="text" value="' + value.unit_price + '" onKeyup="changeQuantity(this,' + value.sales_id + ')" ' + readonly + '></td><td><input class="form-control" id="price" type="text" value="' + value.price + '" onKeyup="changeQuantity(this,' + value.sales_id + ')" ' + readonly1 + '></td><td>' + value.source + '</td><td style="text-align:center">' + onclick + '</td></tr>';
                    $('#poTable').append('<tr id="line_' + value.id + '" class="sales_id_' + value.sales_id + '">' + td + '</tr>');
                });

                $('#poTable').append('<tr><td><b>Subtotal:</b></td><td colspan="3"></td><td id="total"><b>$' + parseFloat(total).toFixed(2) + '</b></td><td></td><td></td></tr>');
                if (source_list != null) {
                    $('#pdf_buttons').empty();
                    var sales_id = breakdown.sales_id;
                    $.each(source_list, function (index, value) {

                        $("#pdf_buttons").append('<button class="btn btn-danger" id="generate_' + index + '" style="margin-right: 10px;">Generate PDF for ' + value + '</button>');
                        $('#generate_' + index).attr('onClick', 'generatePDF(event, ' + sales_id + ',"' + value + '")');


                    });

                }

            }
            $('.comments_table').empty();
            $('.comments_table').append('<tbody>');
            // $('#po_comments').text(updatedContent.po_comments);
            var order_id = updatedContent.sales_id;
            var po_comments = updatedContent.po_comments;
            var i = 0;
            $.each(po_comments, function (index, value) {
                i++;
                var e1 = '<textarea id="po_comments_'+i+'" style="width:100%;height: 100px;resize: vertical;">'+value+'</textarea>';
                var e2 = '<button class="btn btn-primary" id="ad_comments_'+i+'" onClick="event.preventDefault();addComments('+order_id+',\''+index+'\', '+i+')">Add Comments</button>';
                $('.comments_table').append('<tr><td width="10%">'+index+'</td><td>'+e1+e2+'</td></tr>')

            });
            $('.comments_table').append('</tbody>');
            // $('#generate_files2').html("<i class='fa fa-spinner fa-spin'></i> Generating PO pdf");
         
            // generatePDF2(order_id);
        }
    });
}

function getTotal(breakdown, isPVCRoll = false) {
    var amount = breakdown.qty;
    var info = "";

    if (breakdown.unit == "ft") {
        amount *= breakdown.amount;
        if (!isPVCRoll) {
            info = " " + breakdown.unit + " (" + (breakdown.amount * breakdown.qty * 12).toFixed(2) + "in.)";
        }
    }

    amount = parseFloat(amount);
    if (isNaN(amount)) {
        amount = 0.00;
    }

    var html = amount.toFixed(2) + info;
    return html;
}

function deleteRow(id) {
    var formData = new FormData();
    formData.append("id", id);

    $.ajax({
        url: "ajax/sales/delete_review_breakdown.php",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false

    }).done(function (data) {
        var updatedContent = $.parseJSON(data);
        if (updatedContent.type == "success") {
            $(".row_" + id).remove();
            var parentPackage = updatedContent.parentPackage;
            var productPart = updatedContent.productPart;
            var parentQtyValue = "";
            var parentTotalValue = "";
            var parentTotalPrice = 0;
            var boxCount = updatedContent.boxCount;

            $("#totalBoxes").html(boxCount);

            if (parentPackage.type == "Linear_FT") {
                parentQtyValue = parseFloat(parentPackage.total).toFixed(2);
                parentTotalValue = parseFloat(parentPackage.total).toFixed(2);
                parentTotalPrice = parseFloat(parentPackage.total * productPart.price).toFixed(2);
            } else if (parentPackage.type == "Strip_Qty") {
                parentQtyValue = parseFloat(parentPackage.qty).toFixed(2);
                parentTotalValue = parseFloat(parentPackage.total).toFixed(2) + " ft (" + parseFloat(parentPackage.total * 12).toFixed(2) + " in.)";
                parentTotalPrice = parseFloat(parentPackage.total * productPart.price).toFixed(2);
            } else {
                parentQtyValue = parseFloat(parentPackage.qty).toFixed(2);
                parentTotalValue = parseFloat(parentPackage.qty).toFixed(2);
                parentTotalPrice = parseFloat(parentPackage.qty * productPart.price).toFixed(2);
            }

            $("#qty_" + parentPackage.id).text(parentQtyValue);
            $("#total_" + parentPackage.id).text(parentTotalValue);
            $("#price_" + parentPackage.id).text(parentTotalPrice);

            updateShipmentComments();
        }
    });
}

$(document).ready(function () {
    $(".material_amount_field").keydown(function (e) {
        // Allow: backspace, delete, tab, escape, enter and .
        if ($.inArray(e.keyCode, [46, 8, 9, 27, 13, 110, 190]) !== -1 ||
            // Allow: Ctrl/cmd+A
            (e.keyCode == 65 && (e.ctrlKey === true || e.metaKey === true)) ||
            // Allow: Ctrl/cmd+C
            (e.keyCode == 67 && (e.ctrlKey === true || e.metaKey === true)) ||
            // Allow: Ctrl/cmd+X
            (e.keyCode == 88 && (e.ctrlKey === true || e.metaKey === true)) ||
            // Allow: home, end, left, right
            (e.keyCode >= 35 && e.keyCode <= 39)) {
            // let it happen, don't do anything
            return;
        }
        // Ensure that it is a number and stop the keypress
        if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
            e.preventDefault();
        }
    });
});



$("#recountBox").click(function () {
    recountBox();
});

$(document).on('click', ".material_amount_field", function () {
    if ($(this).val() == 0) {
        $(this).val("");
    }
});

//recountBox();
function recountBox() {
    var count = 1;
    $('.boxNumber').each(function () {
        $(this).val(count);
        var id = $(this).attr('id');
        id = id.split("_");
        id = id.slice(-1)[0];

        updateBoxNumber(id, (count - 1));

        count++;
    });
}

function updateFixSku(itemid) {

    var formData = new FormData();
    formData.append('sales_id', orderid_cp);
    formData.append('itemid', itemid);
    formData.append('new_sku', $('#skufixedfield_' + itemid).val());

    $('#fixskubox_' + itemid).html('Updating, please wait...');

    $.ajax({
        url: "ajax/sales/fix_item_sku.php",
        type: "POST",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false,
        success: function (data) {
            var obj = $.parseJSON(data);
            if (obj.type == "error") {

                $('#fixskubox_' + itemid).html(obj.description);

            } else {

                $('#fixskubox_' + itemid).html(obj.description);

                setTimeout(function () {
                    location.reload();
                }, 3000);
            }
        }
    });


}

// check if order shipment type is customer account and validate the account
function checkCustomerAccount() {
    var errors = '';

    var shipmentType = "<?=$order[0]['shipment_type']; ?>";
    // if(shipmentType.includes("Customer Account")) {
    if (shipmentType === "Customer Account (UPS)") {
        var boxesarray = jsarray;
        if (boxesarray.length > 0) { //CHANGE AFTER
            var custAcc = "<?=$order[0]['sales_shipping_customeraccount']; ?>";
            //check if account number is valid (oid?)
            // make request to ups if it ups, else fedex

            setTimeout(function () {

                var datatosend = {
                    'oid': orderid_cp,
                    'service': "<?=$order[0]['shipment_type']; ?>",
                    'addressidentifier': '<?=$keyaddressidentifier; ?>',
                    'boxesarray': boxesarray
                };

                var urltoprocess = 'ajax/request_UPS_Label.php';

                $.get(urltoprocess, datatosend).done(function (data) {

                    var obj = $.parseJSON(data);

                    if (obj.type == "error") {
                        // errors += obj.message + '\n';
                        errors += 'Invalid customer account number or 0 packages are not selected. Please contact the customer and verify the customer account number: ' + custAcc + '\n';
                        $('#printErrors_show2').html(errors);
                    }
                });

            }, 1000);

            //validate the box array
        } else {
            errors += 'Packages need to be set for the shipment type: ' + shipmentType + '.\n';
        }

        if (errors !== '') {
            $('#printErrors_show2').html(errors);
        }
    }
}


function requestShippinglabel() {

    //Set Loading 
    $('#shippingLabelCheck').attr('style', '');
    $('#shippingLabelCheck_show').html("<i class='fa fa-spinner fa-spin'></i> Checking Shipping Label");

    var boxesarray = jsarray;

    setTimeout(function () {

        var datatosend = {
            'oid': orderid_cp,
            'service': "<?=$order[0]['shipment_type']; ?>",
            'addressidentifier': '<?=$keyaddressidentifier; ?>',
            'boxesarray': boxesarray
        };

        var urltoprocess = 'ajax/request_UPS_Label.php';

        $.get(urltoprocess, datatosend).done(function (data) {

            var obj = $.parseJSON(data);

            if (obj.type == "error") {

                $('#shippingLabelCheck_color').attr('class', 'panel panel-red');
                $('#shippingLabelCheck_show').html(obj.message + " <button onclick='requestShippinglabel();'  type='button' class='btn btn-default'>Check Again</button>");

            } else {

                $('#shippingLabelCheck_color').attr('class', 'panel panel-green');
                $('#shippingLabelCheck_show').html("Success! The shipping label has passed the test.");

            }

        });

    }, 1000);

}
function getLevel2Info() {

    $('#Level2-Info-Block').toggle();

    var formData = new FormData();
    formData.append('sales_id', orderid_cp);
    formData.append('parent_id', parent_id);
    formData.append('billing_firstname', "<?php echo $order[0]['billing_firstname']; ?>");
    formData.append('billing_lastname', "<?php echo $order[0]['billing_lastname']; ?>");
    formData.append('billing_company', "<?php echo $order[0]['billing_company']; ?>");

    $.ajax({
        url: "ajax/sales/getLevel2Info.php",
        type: "POST",
        type: "POST",
        data: formData,
        contentType: false,
        cache: false,
        processData: false,
        success: function (data) {
            var obj = $.parseJSON(data);
            if (obj.type == "error") {
            } else {
                //display html content
                var htmlMSGReturn = obj.html;
                $('#level2content').html(htmlMSGReturn);
            }
        }
    });

}


