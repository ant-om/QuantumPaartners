"""
Write a function called 'main' that accepts a list of strings as an input.

Your function should return a list with all the strings in the input list that 
have the character 'd' in the 7th position of the string.
Remove this character from the strings in the output list. 

For example:
If we are calling your function as:
main(['bdcadddbdac', 'bbdcbbcccc', 'dacbbccd', 'cccdbdcbdb', 'acbcddcbdcd', 'dcabcacbbc', 'adaadaaab', 'aabdbccba', 'acddddddcbc', 'dccccbabdb']) 
then it should return the list: 
['bdcaddbdac', 'acdddddcbc']
"""

def main(l1):
    r1 = [x[0:6]+x[7:] for x in l1 if x[6] == 'd']
    return r1
