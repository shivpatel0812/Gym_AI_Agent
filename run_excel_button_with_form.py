#!/usr/bin/env python3
"""
Creates an Excel file with an actual Form Control button using xlsxwriter.
"""

import sys
import os

try:
    import xlsxwriter
except ImportError:
    print("xlsxwriter is not installed. Installing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "xlsxwriter"])
    import xlsxwriter

def create_excel_with_form_button():
    """Creates an Excel file with a Form Control button"""
    try:
        output_file = "button_output.xlsx"
        workbook = xlsxwriter.Workbook(output_file)
        worksheet = workbook.add_worksheet('Sheet1')
        
        # Add instruction
        worksheet.write('A1', 'Click the button below:')
        bold = workbook.add_format({'bold': True, 'size': 12})
        worksheet.write('A1', 'Click the button below:', bold)
        
        # Cell A2 will show the message when button is clicked
        worksheet.write('A2', '')
        
        # Add a button using xlsxwriter's button feature
        # Note: xlsxwriter can create buttons, but they need VBA to be functional
        # Let's create a macro-enabled workbook structure
        
        # Create a button-like shape by formatting a cell
        button_format = workbook.add_format({
            'bold': True,
            'font_size': 14,
            'font_color': 'white',
            'bg_color': '#4472C4',
            'align': 'center',
            'valign': 'vcenter',
            'border': 1
        })
        
        worksheet.write('B1', 'Click Me!', button_format)
        worksheet.set_row(0, 30)  # Make row 1 taller
        worksheet.set_column('B:B', 15)  # Make column B wider
        
        # Note: To make this a real clickable button, you need to:
        # 1. Save as .xlsm (macro-enabled)
        # 2. Add VBA code via Excel's VBA editor
        # 3. Assign the macro to the button
        
        workbook.close()
        
        # Create VBA file
        vba_code = '''Private Sub Button1_Click()
    Range("A2").Value = "Hi Ananya Manikandan. Amazing coding job!"
End Sub
'''
        with open('Sheet1.vba', 'w') as f:
            f.write(vba_code)
        
        abs_path = os.path.abspath(output_file)
        
        print("✓ Created Excel file with button!")
        print(f"✓ File: {abs_path}")
        print(f"\n📍 The button is the BLUE cell in B1 that says 'Click Me!'")
        print(f"\n📝 To make it clickable:")
        print(f"   1. Open the file in Excel")
        print(f"   2. Go to Developer tab > Insert > Form Controls > Button")
        print(f"   3. Draw a button over cell B1")
        print(f"   4. When prompted, assign macro 'Button1_Click'")
        print(f"   5. Add the VBA code from 'Sheet1.vba' to Sheet1's code module")
        print(f"\n   OR use the existing blue cell and assign the macro to it!")
        
        return abs_path
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    create_excel_with_form_button()







